import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  Automation,
  Conversation,
  Execution,
  Integration,
  Lead,
  Member,
  Message,
  Template,
} from './models.js'
import { env } from './config.js'
import { graph, graphList } from './graph.js'
import { failure, leadFilter, manager, publish, visibleLead } from './runtime.js'
import { messagingError, unseal } from './security.js'
import { automation, id, providerId, template } from './validation.js'

export const conversations = Router(),
  rules = Router()
const phonePattern = /^\+[1-9]\d{7,14}$/
export const variablesIn = (body: string) =>
  [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort(
    (a, b) => a - b,
  )
export async function whatsapp(workspaceId: string) {
  const entry = await Integration.findOne({ workspaceId, provider: 'whatsapp' }).select(
    '+credential',
  )
  if (!entry?.credential || !entry.accountId || !entry.phoneId)
    return failure(409, 'Connect WhatsApp Business first.')
  return { accountId: entry.accountId, phoneId: entry.phoneId, token: unseal(entry.credential) }
}
export async function ensureChat(workspaceId: string, leadId: string, phone: string) {
  if (!phonePattern.test(phone)) return failure(400, 'Enter a valid international phone number.')
  const row = await Conversation.findOneAndUpdate(
    { workspaceId, phone },
    { $setOnInsert: { leadId, status: 'open', unread: 0 } },
    { upsert: true, new: true },
  )
  if (!row || row.leadId !== leadId)
    return failure(409, 'That number already belongs to another lead conversation.')
  return row
}
async function allowedChat(req: Request) {
  const row = await Conversation.findOne({
    workspaceId: req.workspaceId,
    _id: id.parse(req.params.id),
  })
  if (!row?.leadId) return failure(404, 'Conversation not found.')
  const lead = await visibleLead(req, row.leadId)
  return { row, lead }
}
conversations.get('/', async (req, res) => {
  const filter = z
    .enum(['All', 'Unread', 'Assigned to me', 'Open', 'Resolved'])
    .default('All')
    .parse(req.query.filter)
  const leadAccess = {
    ...leadFilter(req),
    ...(filter === 'Assigned to me' && { assignedTo: req.userId }),
  }
  const allowed = await Lead.distinct('_id', leadAccess)
  const rows = await Conversation.find({
    workspaceId: req.workspaceId,
    leadId: { $in: allowed.map(String) },
    ...(filter === 'Unread' && { unread: { $gt: 0 } }),
    ...(filter === 'Open' && { status: 'open' }),
    ...(filter === 'Resolved' && { status: 'resolved' }),
  })
    .sort('-updatedAt')
    .limit(100)
    .lean()
  const leads = await Lead.find({
    ...leadAccess,
    _id: { $in: rows.map((row) => row.leadId) },
  }).lean()
  res.json(
    rows.map((row) => ({ ...row, lead: leads.find((lead) => String(lead._id) === row.leadId) })),
  )
})
conversations.post('/', async (req, res) => {
  const leadId = id.parse(req.body.leadId)
  const lead = await visibleLead(req, leadId)
  await whatsapp(req.workspaceId)
  res.status(201).json(await ensureChat(req.workspaceId, leadId, lead.phone || ''))
})
conversations.get('/:id', async (req, res) => {
  const { row, lead } = await allowedChat(req)
  res.json({ ...row.toObject(), lead })
})
conversations.patch('/:id', async (req, res) => {
  const { row } = await allowedChat(req)
  const input = z
    .object({ status: z.enum(['open', 'resolved']).optional(), unread: z.literal(0).optional() })
    .parse(req.body)
  await row.updateOne(input)
  publish(req.workspaceId)
  res.json({ ok: true })
})
conversations.get('/:id/messages', async (req, res) => {
  const { row } = await allowedChat(req)
  const messages = await Message.find({
    workspaceId: req.workspaceId,
    conversationId: String(row._id),
  })
    .sort('-createdAt')
    .limit(200)
  res.json(messages.reverse())
})
conversations.get('/:id/media/:mediaId', async (req, res) => {
  const { row } = await allowedChat(req)
  const mediaId = providerId.parse(req.params.mediaId)
  const message = await Message.findOne({
    workspaceId: req.workspaceId,
    conversationId: String(row._id),
    mediaId,
    direction: 'inbound',
    type: { $in: ['image', 'document'] },
  })
  if (!message) return failure(404, 'Attachment not found.')
  const { token, phoneId } = await whatsapp(req.workspaceId)
  const metadata = await graph<{ url: string; file_size?: number; mime_type?: string }>(
    mediaId,
    token,
    { phone_number_id: phoneId },
  )
  const url = new URL(metadata.url)
  if (
    url.protocol !== 'https:' ||
    !['lookaside.fbsbx.com', 'lookaside.facebook.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !metadata.file_size ||
    metadata.file_size > 15 * 1024 * 1024
  )
    return failure(400, 'This attachment cannot be downloaded.')
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok || !response.body)
    return failure(502, 'WhatsApp could not return the attachment.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 15 * 1024 * 1024) {
      await reader.cancel()
      return failure(400, 'This attachment exceeds the download limit.')
    }
    chunks.push(value)
  }
  const mime = metadata.mime_type || ''
  const safeImage = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)
  const extension = safeImage ? mime.slice(6) : mime === 'application/pdf' ? 'pdf' : 'bin'
  res
    .attachment('whatsapp-attachment.' + extension)
    .type('application/octet-stream')
    .send(Buffer.concat(chunks))
})
const payload = z.object({
  text: z.string().trim().min(1).max(4096).optional(),
  templateId: id.optional(),
  variables: z.array(z.string().min(1).max(1024)).max(20).default([]),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'document']).optional(),
})
type Content = z.infer<typeof payload>
export async function outbound(
  workspaceId: string,
  conversationId: string,
  requestId: string,
  input: Content,
  automationExecution?: string,
) {
  const row = await Conversation.findOne({ workspaceId, _id: conversationId })
  const lead = row?.leadId
    ? await Lead.findOne({ workspaceId, _id: row.leadId, archivedAt: null })
    : null
  if (!row?.phone || !lead || lead.phone !== row.phone)
    return failure(409, 'The lead phone number has changed.')
  const { phoneId } = await whatsapp(workspaceId)
  const selected = input.templateId
    ? await Template.findOne({ workspaceId, _id: input.templateId, status: 'approved' })
    : null
  if (input.templateId && !selected) return failure(400, 'Choose a currently approved template.')
  if (await Lead.exists({ workspaceId, phone: row.phone, consent: 'opted_out' }))
    return failure(400, 'This phone number has opted out.')
  const reason = messagingError(
    lead.consent ?? undefined,
    row.lastInboundPhoneId === phoneId ? row.lastInboundAt : undefined,
    !!selected,
  )
  if (reason) return failure(400, reason)
  const type = selected ? 'template' : input.mediaType || 'text'
  if (!selected && !input.text && !input.mediaUrl) return failure(400, 'Enter a message.')
  if (selected && variablesIn(selected.body || '').length !== input.variables.length)
    return failure(400, 'Provide a value for every template variable.')
  if (input.mediaUrl || input.mediaType) {
    const url = input.mediaUrl ? new URL(input.mediaUrl) : null
    if (
      !url ||
      !input.mediaType ||
      url.protocol !== 'https:' ||
      !env.MEDIA_ORIGIN ||
      url.origin !== env.MEDIA_ORIGIN
    )
      return failure(400, 'Use an HTTPS attachment from the configured media origin.')
  }
  const text = selected
    ? (selected.body || '').replace(
        /\{\{(\d+)\}\}/g,
        (_match, index) => input.variables[Number(index) - 1] || '',
      )
    : input.text || ''
  const filter = { workspaceId, conversationId, requestId }
  const result = await Message.findOneAndUpdate(
    filter,
    {
      $setOnInsert: {
        ...filter,
        direction: 'outbound',
        type,
        text,
        status: 'queued',
        templateId: input.templateId,
        variables: input.variables,
        mediaUrl: input.mediaUrl,
        providerPhoneId: phoneId,
        automationExecution,
      },
    },
    { upsert: true, new: true },
  )
  publish(workspaceId)
  return result
}
conversations.post('/:id/messages', async (req, res) => {
  const { row } = await allowedChat(req)
  const input = payload.extend({ requestId: z.string().uuid() }).parse(req.body)
  res.status(202).json(await outbound(req.workspaceId, String(row._id), input.requestId, input))
})
const draftInput = template.refine(
  (input) => {
    const values = variablesIn(input.body)
    return values.length <= 20 && values.every((value, index) => value === index + 1)
  },
  { path: ['body'], message: 'Use contiguous numbered variables.' },
)
rules.get('/templates', async (req, res) => {
  res.json(await Template.find({ workspaceId: req.workspaceId }).sort('name').limit(300))
})
rules.post('/templates', async (req, res) => {
  manager(req)
  res.status(201).json(
    await Template.create({
      ...draftInput.parse(req.body),
      workspaceId: req.workspaceId,
      status: 'draft',
    }),
  )
})
rules.patch('/templates/:id', async (req, res) => {
  manager(req)
  const row = await Template.findOneAndUpdate(
    { workspaceId: req.workspaceId, _id: id.parse(req.params.id), status: 'draft' },
    draftInput.parse(req.body),
    { new: true },
  )
  if (!row) return failure(404, 'Editable draft not found.')
  res.json(row)
})
rules.post('/templates/:id/submit', async (req, res) => {
  manager(req)
  const row = await Template.findOne({
    workspaceId: req.workspaceId,
    _id: id.parse(req.params.id),
    status: 'draft',
  })
  if (!row?.body) return failure(404, 'Editable draft not found.')
  const variables = variablesIn(row.body)
  const examples = z
    .array(z.string().trim().min(1).max(256))
    .max(20)
    .default([])
    .parse(req.body.examples)
  if (variables.length !== examples.length)
    return failure(400, 'Provide one example for every template variable.')
  const { accountId, token } = await whatsapp(req.workspaceId)
  const result = await graph<{ id: string; status?: string }>(
    accountId + '/message_templates',
    token,
    {},
    {
      name: row.name,
      category: row.category,
      language: row.language,
      components: [
        {
          type: 'BODY',
          text: row.body,
          ...(examples.length && { example: { body_text: [examples] } }),
        },
      ],
    },
  )
  await row.updateOne({ externalId: result.id, status: result.status?.toLowerCase() || 'pending' })
  res.json({ ok: true })
})
rules.post('/templates/sync', async (req, res) => {
  manager(req)
  const { accountId, token } = await whatsapp(req.workspaceId)
  const rows = await graphList<{
    id: string
    name: string
    category: string
    language: string
    status: string
    components: { type: string; text?: string }[]
  }>(accountId + '/message_templates', token, 'id,name,category,language,status,components')
  await Template.updateMany(
    {
      workspaceId: req.workspaceId,
      externalId: { $nin: rows.map((row) => row.id), $type: 'string' },
    },
    { $set: { status: 'unavailable' } },
  )
  for (const row of rows) {
    const body = row.components.find((component) => component.type === 'BODY')?.text || ''
    await Template.updateOne(
      { workspaceId: req.workspaceId, name: row.name, language: row.language },
      {
        body,
        category: row.category,
        status: row.status.toLowerCase(),
        externalId: row.id,
        components: row.components,
      },
      { upsert: true },
    )
  }
  res.json({ count: rows.length })
})
async function validateRule(workspaceId: string, input: z.infer<typeof automation>) {
  if (
    input.action === 'assign' &&
    input.assignedTo &&
    !(await Member.exists({ workspaceId, userId: input.assignedTo }))
  )
    failure(400, 'Choose a workspace member.')
  if (input.action === 'template') {
    const row = await Template.findOne({ workspaceId, _id: input.templateId, status: 'approved' })
    if (!row || variablesIn(row.body || '').length !== (input.templateVariables || []).length)
      failure(400, 'Choose an approved template and map every variable.')
  }
}
rules.get('/automations', async (req, res) => {
  manager(req)
  res.json(await Automation.find({ workspaceId: req.workspaceId }).sort('-createdAt'))
})
rules.post('/automations', async (req, res) => {
  manager(req)
  const input = automation.parse(req.body)
  await validateRule(req.workspaceId, input)
  res
    .status(201)
    .json(
      await Automation.create({ delay: 0, enabled: false, ...input, workspaceId: req.workspaceId }),
    )
})
rules.patch('/automations/:id', async (req, res) => {
  manager(req)
  const scope = { workspaceId: req.workspaceId, _id: id.parse(req.params.id) }
  const row = await Automation.findOne(scope)
  if (!row) return failure(404, 'Automation not found.')
  const input = automation.parse({ ...row.toObject(), ...automation.partial().parse(req.body) })
  if (input.enabled) await validateRule(req.workspaceId, input)
  await row.updateOne(input)
  if (!input.enabled)
    await Execution.updateMany(
      { workspaceId: req.workspaceId, automationId: String(row._id), status: 'pending' },
      { status: 'cancelled' },
    )
  res.json({ ok: true })
})
rules.delete('/automations/:id', async (req, res) => {
  manager(req)
  const automationId = id.parse(req.params.id)
  await Automation.deleteOne({ workspaceId: req.workspaceId, _id: automationId })
  await Execution.updateMany(
    { workspaceId: req.workspaceId, automationId, status: 'pending' },
    { status: 'cancelled' },
  )
  res.json({ ok: true })
})
rules.get('/automations/:id/executions', async (req, res) => {
  manager(req)
  res.json(
    await Execution.find({ workspaceId: req.workspaceId, automationId: id.parse(req.params.id) })
      .sort('-dueAt')
      .limit(100),
  )
})
