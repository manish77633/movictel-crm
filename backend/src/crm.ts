import { Router, type Request } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import {
  Activity,
  Conversation,
  FollowUp,
  Invitation,
  Lead,
  Member,
  Message,
  Note,
  Notification,
  User,
} from './models.js'
import { failure, leadFilter, manager, publish, record, schedule, visibleLead } from './runtime.js'
import { email, followUp, id, lead, line, password, role, statuses } from './validation.js'
import { digest, passwordHash, randomToken } from './security.js'
import { isSheetAdmin, sheetAdminEmails } from './sheet-sources.js'
import { sendEmail } from './auth.js'
import { frontend, production } from './config.js'

export const crm = Router()
const leadInput = lead.partial()
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const leadsFilter = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(statuses).optional(),
  source: z.string().max(80).optional(),
  assignedTo: id.optional(),
  campaign: z.string().max(160).optional(),
  campaignSheetId: id.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['newest', 'oldest', 'name']).default('newest'),
})
function filteredLeads(req: Request, query: z.infer<typeof leadsFilter>) {
  const { q, status, source, assignedTo, campaign, campaignSheetId } = query
  const filter = {
    ...leadFilter(req),
    ...(status && { status }),
    ...(source && { source }),
    ...(campaign && { campaign }),
    ...(campaignSheetId && { campaignSheetId }),
  }
  const regex = q ? new RegExp(escape(q), 'i') : undefined
  return {
    ...filter,
    ...(assignedTo && req.role !== 'agent' && { assignedTo }),
    ...(regex && { $or: [{ name: regex }, { email: regex }, { phone: regex }] }),
  }
}
crm.get('/leads', async (req, res) => {
  const query = leadsFilter.parse(req.query)
  const filter = filteredLeads(req, query)
  const sort =
    query.sort === 'name'
      ? 'name _id'
      : query.sort === 'oldest'
        ? 'createdAt _id'
        : '-createdAt -_id'
  const [rows, total] = await Promise.all([
    Lead.find(filter)
      .select('-sheetFields')
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Lead.countDocuments(filter),
  ])
  res.json({ rows, total })
})
crm.get('/leads/export', async (req, res) => {
  const rows = await Lead.find(filteredLeads(req, leadsFilter.parse(req.query)))
    .select('name phone email company source campaign campaignSheetName status')
    .sort('-createdAt')
    .limit(10_000)
    .lean()
  const csv = (value: unknown) =>
    '"' +
    String(value ?? '')
      .replace(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/, (value) => "'" + value)
      .replaceAll('"', '""') +
    '"'
  await record(
    req.workspaceId,
    '',
    'leads.exported',
    'Exported ' + rows.length + ' leads',
    req.userId,
  )
  res
    .attachment('leads.csv')
    .type('text/csv')
    .send(
      [
        'Name,Phone,Email,Company,Source,Campaign,Status',
        ...rows.map((row) =>
          [
            row.name,
            row.phone,
            row.email,
            row.company,
            row.source,
            row.campaignSheetName || row.campaign,
            row.status,
          ]
            .map(csv)
            .join(','),
        ),
      ].join('\r\n'),
    )
})
crm.post('/leads', async (req, res) => {
  const input = lead.parse(req.body)
  const row = await Lead.create({
    status: 'New',
    consent: 'unknown',
    ...input,
    workspaceId: req.workspaceId,
    source: 'Manual',
    assignedTo: req.userId,
    consentAt: input.consent === 'granted' ? new Date() : undefined,
  })
  await record(req.workspaceId, String(row._id), 'lead.created', 'Lead added', req.userId)
  publish(req.workspaceId)
  res.status(201).json(row)
})
crm.get('/leads/:id', async (req, res) => {
  const leadId = id.parse(req.params.id)
  const row = await visibleLead(req, leadId)
  const scope = { workspaceId: req.workspaceId, leadId }
  const [notes, activities, followUps, conversation] = await Promise.all([
    Note.find(scope).sort('-createdAt').limit(100),
    Activity.find(scope).sort('-createdAt').limit(100),
    FollowUp.find(scope).sort('dueAt').limit(100),
    Conversation.findOne(scope),
  ])
  res.json({ row, notes, activities, followUps, conversation })
})
async function changeLead(req: Request, input: z.infer<typeof leadInput>) {
  const row = await visibleLead(req, id.parse(req.params.id))
  const oldStatus = row.status
  row.set(input)
  if (input.consent === 'granted' && row.isModified('consent')) row.set('consentAt', new Date())
  if (input.status === 'Contacted' && !row.contactedAt) row.set('contactedAt', new Date())
  await row.save()
  if (input.status && input.status !== oldStatus) {
    const event = await record(
      req.workspaceId,
      String(row._id),
      'lead.status',
      'Moved to ' + input.status,
      req.userId,
    )
    await schedule(
      req.workspaceId,
      String(row._id),
      'lead.status',
      String(event._id),
      row.formId ?? undefined,
    )
  }
  publish(req.workspaceId)
  return row
}
crm.patch('/leads/:id', async (req, res) => {
  res.json(await changeLead(req, leadInput.parse(req.body)))
})
crm.patch('/leads/:id/status', async (req, res) => {
  res.json(await changeLead(req, z.object({ status: z.enum(statuses) }).parse(req.body)))
})
crm.delete('/leads/:id', async (req, res) => {
  manager(req)
  const row = await visibleLead(req, id.parse(req.params.id))
  await row.updateOne({ archivedAt: new Date() })
  await record(req.workspaceId, String(row._id), 'lead.archived', 'Lead archived', req.userId)
  publish(req.workspaceId)
  res.json({ ok: true })
})
crm.post('/leads/:id/notes', async (req, res) => {
  const row = await visibleLead(req, id.parse(req.params.id))
  const text = z.string().trim().min(1).max(5000).parse(req.body.text)
  const note = await Note.create({
    workspaceId: req.workspaceId,
    leadId: String(row._id),
    authorId: req.userId,
    text,
  })
  await record(req.workspaceId, String(row._id), 'lead.note', 'Note added', req.userId)
  publish(req.workspaceId)
  res.status(201).json(note)
})
async function assign(req: Request, leadIds: string[], userId: string) {
  manager(req)
  if (!(await Member.exists({ workspaceId: req.workspaceId, userId })))
    failure(400, 'Choose a workspace member.')
  const rows = await Lead.find({ ...leadFilter(req), _id: { $in: leadIds } })
  if (rows.length !== new Set(leadIds).size) failure(404, 'One or more leads are unavailable.')
  await Lead.updateMany({ ...leadFilter(req), _id: { $in: leadIds } }, { assignedTo: userId })
  await FollowUp.updateMany(
    { workspaceId: req.workspaceId, leadId: { $in: leadIds }, status: 'pending' },
    { $set: { assignedTo: userId }, $unset: { notifiedAt: 1 } },
  )
  await Promise.all(
    rows.map((row) =>
      record(req.workspaceId, String(row._id), 'lead.assigned', 'Lead assigned', req.userId),
    ),
  )
  publish(req.workspaceId)
}
crm.post('/leads/:id/assign', async (req, res) => {
  await assign(req, [id.parse(req.params.id)], id.parse(req.body.userId))
  res.json({ ok: true })
})
crm.post('/leads/bulk-assign', async (req, res) => {
  const input = z.object({ ids: z.array(id).min(1).max(100), userId: id }).parse(req.body)
  await assign(req, input.ids, input.userId)
  res.json({ ok: true })
})
async function visibleIds(req: Request) {
  return req.role === 'agent'
    ? await Lead.distinct('_id', leadFilter(req)).then((ids) => ids.map(String))
    : undefined
}
crm.get('/followups', async (req, res) => {
  const ids = await visibleIds(req)
  const rows = await FollowUp.find({
    workspaceId: req.workspaceId,
    ...(ids && { leadId: { $in: ids } }),
  })
    .sort('dueAt')
    .limit(200)
    .lean()
  res.json(
    rows.map((row) => ({
      ...row,
      status:
        row.status === 'pending' && row.dueAt && row.dueAt < new Date() ? 'overdue' : row.status,
    })),
  )
})
crm.post('/followups', async (req, res) => {
  const input = followUp.parse(req.body)
  const lead = await visibleLead(req, input.leadId)
  const task = await FollowUp.create({
    priority: 'normal',
    ...input,
    workspaceId: req.workspaceId,
    assignedTo: lead.assignedTo,
    status: 'pending',
  })
  await record(req.workspaceId, input.leadId, 'followup.created', 'Follow-up scheduled', req.userId)
  await schedule(
    req.workspaceId,
    input.leadId,
    'followup.created',
    String(task._id),
    lead.formId ?? undefined,
  )
  publish(req.workspaceId)
  res.status(201).json(task)
})
async function updateTask(req: Request, patch: object) {
  const row = await FollowUp.findOne({ workspaceId: req.workspaceId, _id: id.parse(req.params.id) })
  if (!row?.leadId) return failure(404, 'Follow-up not found.')
  await visibleLead(req, row.leadId)
  row.set(patch)
  if (row.isModified('dueAt')) row.set('notifiedAt', undefined)
  await row.save()
  publish(req.workspaceId)
  return row
}
crm.patch('/followups/:id', async (req, res) => {
  res.json(
    await updateTask(
      req,
      followUp
        .omit({ leadId: true })
        .partial()
        .extend({ status: z.enum(['pending', 'completed', 'cancelled']).optional() })
        .parse(req.body),
    ),
  )
})
crm.delete('/followups/:id', async (req, res) => {
  res.json(await updateTask(req, { status: 'cancelled' }))
})
crm.get('/dashboard/activities', async (req, res) => {
  const ids = await visibleIds(req)
  res.json(
    await Activity.find({ workspaceId: req.workspaceId, ...(ids && { leadId: { $in: ids } }) })
      .sort('-createdAt')
      .limit(30),
  )
})
const dateFilter = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
})
crm.get(['/dashboard/overview', '/dashboard/analytics'], async (req, res) => {
  const query = leadsFilter.merge(dateFilter).parse(req.query)
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 29 * 86400_000)
  const to = query.to ? new Date(query.to) : new Date()
  if (to < from || to.getTime() - from.getTime() > 366 * 86400_000)
    return failure(400, 'Choose a date range up to one year.')
  const filter = { ...filteredLeads(req, query), createdAt: { $gte: from, $lte: to } }
  const [report, recent] = await Promise.all([
    Lead.aggregate([
      { $match: filter },
      {
        $facet: {
          stages: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          sources: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
          campaigns: [
            {
              $group: { _id: { $ifNull: ['$campaignSheetName', '$campaign'] }, count: { $sum: 1 } },
            },
          ],
          forms: [{ $group: { _id: '$formId', count: { $sum: 1 } } }],
          team: [{ $group: { _id: '$assignedTo', count: { $sum: 1 } } }],
          dates: [
            {
              $group: {
                _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          response: [
            { $match: { contactedAt: { $type: 'date' } } },
            {
              $group: {
                _id: null,
                average: { $avg: { $subtract: ['$contactedAt', '$createdAt'] } },
              },
            },
          ],
        },
      },
    ]),
    Lead.find(filter).select('-sheetFields').sort('-createdAt').limit(8).lean(),
  ])
  const conversations =
    req.role === 'agent'
      ? await Conversation.distinct('_id', {
          workspaceId: req.workspaceId,
          leadId: { $in: await visibleIds(req) },
        })
      : undefined
  const messages = await Message.aggregate([
    {
      $match: {
        workspaceId: req.workspaceId,
        direction: 'outbound',
        createdAt: { $gte: from, $lte: to },
        ...(conversations && { conversationId: { $in: conversations.map(String) } }),
      },
    },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  res.json({ ...report[0], recent, messages })
})
crm.get('/team', async (req, res) => {
  const rows = await Member.find({ workspaceId: req.workspaceId }).lean()
  const users = await User.find({ _id: { $in: rows.map((row) => row.userId) } })
    .select('name email')
    .lean()
  res.json(
    rows.map((row) => ({ ...row, user: users.find((user) => String(user._id) === row.userId) })),
  )
})
crm.post('/team/clients', async (req, res) => {
  manager(req)
  if (!(await isSheetAdmin(req.userId))) return failure(403, 'Only a CRM admin can add clients.')
  const input = z
    .discriminatedUnion('action', [
      z.object({ action: z.literal('create'), email, name: line, password }),
      z.object({ action: z.literal('grant'), email }),
    ])
    .parse(req.body)
  if (sheetAdminEmails().includes(input.email)) return failure(409, 'Use a client email address.')
  await mongoose.connection.transaction(async (session) => {
    let user = await User.findOne({ email: input.email }).session(session)
    if (input.action === 'create') {
      if (user)
        return failure(409, 'This email already has an account. Use Grant workspace access.')
      const [created] = await User.create(
        [
          {
            email: input.email,
            name: input.name,
            password: passwordHash(input.password),
            verified: true,
          },
        ],
        { session },
      )
      user = created
    }
    if (!user?.verified) return failure(404, 'No active account uses this email.')
    await Member.updateOne(
      { workspaceId: req.workspaceId, userId: user.id },
      { $setOnInsert: { role: 'client' } },
      { upsert: true, session },
    )
  })
  res.status(201).json({ ok: true })
})
crm.post('/team/invite', async (req, res) => {
  if (production) return failure(404, 'Use the admin panel to create client accounts.')
  if (req.role !== 'owner') return failure(403, 'Only an owner can invite members.')
  const input = z.object({ email, role }).parse(req.body)
  const token = randomToken()
  await Invitation.create({
    ...input,
    workspaceId: req.workspaceId,
    digest: digest(token),
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  })
  await sendEmail(
    input.email,
    'Join a Relay workspace',
    frontend + '/account?mode=invite&token=' + token,
  )
  res.status(201).json({ ok: true })
})
crm.patch('/team/:id', async (req, res) => {
  if (req.role !== 'owner') return failure(403, 'Only an owner can change roles.')
  const row = await Member.findOneAndUpdate(
    { _id: id.parse(req.params.id), workspaceId: req.workspaceId, role: { $ne: 'owner' } },
    { role: role.parse(req.body.role) },
    { new: true },
  )
  if (!row) return failure(404, 'Member not found.')
  res.json(row)
})
crm.delete('/team/:id', async (req, res) => {
  manager(req)
  if (req.role !== 'owner' && !(await isSheetAdmin(req.userId)))
    return failure(403, 'Only a CRM admin can remove clients.')
  const row = await Member.findOneAndDelete({
    _id: id.parse(req.params.id),
    workspaceId: req.workspaceId,
    role: req.role === 'owner' ? { $ne: 'owner' } : 'client',
  })
  if (!row) return failure(404, 'Member not found.')
  if (row.userId) {
    await Lead.updateMany(
      { workspaceId: req.workspaceId, assignedTo: row.userId },
      { $unset: { assignedTo: 1 } },
    )
    await FollowUp.updateMany(
      { workspaceId: req.workspaceId, assignedTo: row.userId },
      { $unset: { assignedTo: 1 } },
    )
  }
  publish(req.workspaceId)
  res.json({ ok: true })
})
crm.get('/notifications', async (req, res) => {
  res.json(
    await Notification.find({ workspaceId: req.workspaceId, userId: req.userId })
      .sort('-createdAt')
      .limit(40),
  )
})
crm.patch('/notifications/:id', async (req, res) => {
  await Notification.updateOne(
    { _id: id.parse(req.params.id), workspaceId: req.workspaceId, userId: req.userId },
    { read: true },
  )
  res.json({ ok: true })
})
