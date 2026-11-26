import { Queue, Worker } from 'bullmq'
import {
  Activity,
  Automation,
  Conversation,
  Execution,
  FollowUp,
  Lead,
  Member,
  Message,
  Notification,
  Template,
  WebhookEvent,
  Workspace,
} from './models.js'
import { required } from './config.js'
import { processEvent } from './incoming.js'
import { graph } from './graph.js'
import { ensureChat, outbound, whatsapp } from './messaging.js'
import { messagingError } from './security.js'
import { publish } from './runtime.js'

export async function deliver(messageId: string) {
  const row = await Message.findOneAndUpdate(
    { _id: messageId, status: 'queued' },
    { status: 'sending', startedAt: new Date() },
    { new: true },
  )
  if (!row?.workspaceId || !row.conversationId) return
  const workspaceId = row.workspaceId
  const chat = await Conversation.findOne({ _id: row.conversationId, workspaceId })
  const lead = chat?.leadId
    ? await Lead.findOne({ _id: chat.leadId, workspaceId, archivedAt: null })
    : null
  const template = row.templateId
    ? await Template.findOne({ _id: row.templateId, workspaceId, status: 'approved' })
    : null
  const execution = row.automationExecution
    ? await Execution.findOne({ _id: row.automationExecution, workspaceId })
    : null
  const active = execution
    ? await Automation.exists({ _id: execution.automationId, workspaceId, enabled: true })
    : null
  const blocked =
    !!row.automationExecution &&
    (!execution ||
      !active ||
      lead?.status === 'Converted' ||
      lead?.status === 'Lost' ||
      !!(chat?.lastInboundAt && execution.createdAt && chat.lastInboundAt >= execution.createdAt))
  const denied =
    !chat?.phone ||
    !lead ||
    lead.phone !== chat.phone ||
    blocked ||
    (row.templateId && !template) ||
    messagingError(
      lead.consent ?? undefined,
      chat.lastInboundPhoneId === row.providerPhoneId ? chat.lastInboundAt : undefined,
      !!template,
    ) ||
    (await Lead.exists({ workspaceId, phone: chat.phone, consent: 'opted_out' }))
  if (denied) {
    await Message.updateOne({ _id: row._id, status: 'sending' }, { status: 'failed' })
    publish(workspaceId)
    return
  }
  let requestStarted = false
  try {
    const { phoneId, token } = await whatsapp(workspaceId)
    if (row.providerPhoneId !== phoneId) throw new Error('The WhatsApp number was changed.')
    const type = row.type || 'text'
    const text = row.text || ''
    const content = template
      ? {
          template: {
            name: template.name,
            language: { code: template.language },
            ...(row.variables?.length && {
              components: [
                {
                  type: 'body',
                  parameters: row.variables.map((value) => ({ type: 'text', text: value })),
                },
              ],
            }),
          },
        }
      : type === 'image' || type === 'document'
        ? { [type]: { link: row.mediaUrl, ...(text && { caption: text }) } }
        : { text: { body: text } }
    requestStarted = true
    const result = await graph<{ messages?: { id: string }[] }>(
      phoneId + '/messages',
      token,
      {},
      {
        messaging_product: 'whatsapp',
        to: chat.phone!.slice(1),
        type,
        biz_opaque_callback_data: String(row._id),
        ...content,
      },
    )
    const externalId = result.messages?.[0]?.id
    if (!externalId) throw new Error('Meta did not return a message ID.')
    await Message.updateOne(
      { _id: row._id, status: { $in: ['sending', 'unknown'] } },
      { externalId, status: 'sent', providerTimestamp: new Date() },
    )
    await Lead.updateOne(
      { _id: lead._id, workspaceId, contactedAt: null },
      { contactedAt: new Date() },
    )
    await Conversation.updateOne({ _id: chat._id, workspaceId }, { lastMessage: text })
    await Activity.updateOne(
      { workspaceId, eventKey: 'message:' + row._id },
      {
        $setOnInsert: {
          leadId: String(lead._id),
          kind: 'message.sent',
          detail: 'WhatsApp message sent',
        },
      },
      { upsert: true },
    )
  } catch (error) {
    const status = (error as { providerStatus?: number }).providerStatus
    // A network timeout after sending is ambiguous. A later Meta receipt can reconcile it.
    await Message.updateOne(
      { _id: row._id, status: 'sending' },
      { status: !requestStarted || (status && status < 500) ? 'failed' : 'unknown' },
    )
  }
  publish(workspaceId)
}
async function execute(executionId: string) {
  const job = await Execution.findOne({ _id: executionId, status: 'pending' }).lean()
  if (!job?.workspaceId || !job.leadId) return
  const { workspaceId, leadId } = job
  const scope = { workspaceId, _id: executionId, status: 'pending' }
  const [rule, lead] = await Promise.all([
    Automation.findOne({ workspaceId, _id: job.automationId, enabled: true }),
    Lead.findOne({ workspaceId, _id: leadId, archivedAt: null }),
  ])
  if (!rule || !lead || ['Converted', 'Lost'].includes(lead.status || '')) {
    await Execution.updateOne(scope, { status: 'cancelled' })
    return
  }
  if (rule.action === 'template') {
    if (!lead.phone || lead.consent !== 'granted') {
      await Execution.updateOne(scope, { status: 'cancelled' })
      return
    }
    const chat = await ensureChat(workspaceId, leadId, lead.phone)
    if (chat.lastInboundAt && job.createdAt && chat.lastInboundAt >= job.createdAt) {
      await Execution.updateOne(scope, { status: 'cancelled' })
      return
    }
    await outbound(
      workspaceId,
      String(chat._id),
      'automation-' + executionId,
      {
        templateId: rule.templateId ?? undefined,
        variables: (rule.templateVariables || []).map((key) => String(lead.get(key) || '')),
      },
      executionId,
    )
  }
  if (rule.action === 'assign') {
    const members = await Member.find({
      workspaceId,
      ...(rule.assignedTo ? { userId: rule.assignedTo } : { role: 'agent' }),
    })
      .sort('_id')
      .lean()
    if (!members.length) {
      await Execution.updateOne(scope, { status: 'cancelled' })
      return
    }
    const sequence = rule.assignedTo
      ? 0
      : (
          await Workspace.findOneAndUpdate(
            { _id: workspaceId },
            { $inc: { assignmentCursor: 1 } },
            { new: false },
          )
        )?.get('assignmentCursor') || 0
    const userId = members[sequence % members.length].userId
    await Lead.updateOne({ workspaceId, _id: leadId }, { assignedTo: userId })
    await FollowUp.updateMany(
      { workspaceId, leadId, status: 'pending' },
      { $set: { assignedTo: userId }, $unset: { notifiedAt: 1 } },
    )
    await Activity.updateOne(
      { workspaceId, eventKey: 'assign:' + executionId },
      { $setOnInsert: { leadId, kind: 'lead.assigned', detail: 'Assigned by automation' } },
      { upsert: true },
    )
  }
  if (rule.action === 'followup')
    await FollowUp.updateOne(
      { workspaceId, eventKey: 'automation:' + executionId },
      {
        $setOnInsert: {
          leadId,
          assignedTo: lead.assignedTo,
          dueAt: new Date(),
          status: 'pending',
          priority: 'normal',
          description: rule.name,
        },
      },
      { upsert: true },
    )
  if (rule.action === 'notification' && lead.assignedTo)
    await Notification.updateOne(
      { workspaceId, eventKey: 'automation:' + executionId },
      { $setOnInsert: { leadId, userId: lead.assignedTo, text: rule.name, read: false } },
      { upsert: true },
    )
  await Execution.updateOne(scope, { status: 'completed' })
  publish(workspaceId)
}
export async function startWorker() {
  const redis = new URL(required('REDIS_URL'))
  if (!['redis:', 'rediss:'].includes(redis.protocol)) throw new Error('REDIS_URL must use Redis.')
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    username: redis.username ? decodeURIComponent(redis.username) : undefined,
    password: redis.password ? decodeURIComponent(redis.password) : undefined,
    db: Number(redis.pathname.slice(1) || 0),
    ...(redis.protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null,
  }
  const queue = new Queue('relay-jobs', { connection })
  const worker = new Worker(
    'relay-jobs',
    async (job) => {
      if (job.name === 'event') await processEvent(job.data.id)
      if (job.name === 'send') await deliver(job.data.id)
      if (job.name === 'automation') await execute(job.data.id)
    },
    { connection, concurrency: 5, limiter: { max: 10, duration: 1000 } },
  )
  worker.on('error', () => console.error('Relay worker connection error.'))
  worker.on('failed', (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts || 1)) return
    const filter = { _id: job.data.id, status: { $in: ['pending', 'queued', 'sending'] } }
    const update =
      job.name === 'event'
        ? WebhookEvent.updateOne(filter, { status: 'failed' })
        : job.name === 'automation'
          ? Execution.updateOne(filter, { status: 'failed' })
          : Message.updateOne(filter, { status: 'unknown' })
    void update.catch(() => console.error('Could not record failed job.'))
  })
  await Promise.race([
    worker.waitUntilReady(),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Redis startup timed out.')), 15000)
      timer.unref()
    }),
  ])
  let scanning: Promise<void> | undefined
  async function scan() {
    const time = new Date()
    await Message.updateMany(
      { status: 'sending', startedAt: { $lt: new Date(Date.now() - 120000) } },
      { status: 'unknown' },
    )
    const [events, messages, executions, tasks] = await Promise.all([
      WebhookEvent.find({ status: 'pending' }).sort('createdAt').select('_id').limit(100),
      Message.find({ status: 'queued' }).sort('createdAt').select('_id').limit(100),
      Execution.find({ status: 'pending', dueAt: { $lte: time } })
        .sort('dueAt')
        .select('_id')
        .limit(100),
      FollowUp.find({
        status: 'pending',
        dueAt: { $lte: new Date(Date.now() + 900000) },
        notifiedAt: null,
        assignedTo: { $type: 'string' },
      }).limit(100),
    ])
    for (const [name, rows] of [
      ['event', events],
      ['send', messages],
      ['automation', executions],
    ] as const)
      for (const row of rows) {
        const id = String(row._id)
        await queue.add(
          name,
          { id },
          {
            jobId: name + '-' + id,
            attempts: name === 'send' ? 1 : 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 86400, count: 10000 },
            removeOnFail: { age: 86400, count: 10000 },
          },
        )
      }
    for (const task of tasks) {
      if (!task.workspaceId || !task.assignedTo) continue
      if (
        await Lead.exists({
          _id: task.leadId,
          workspaceId: task.workspaceId,
          archivedAt: null,
          assignedTo: task.assignedTo,
        })
      ) {
        await Notification.updateOne(
          {
            workspaceId: task.workspaceId,
            eventKey: 'followup:' + task._id + ':' + task.dueAt?.getTime(),
          },
          {
            $setOnInsert: {
              leadId: task.leadId,
              userId: task.assignedTo,
              text: 'Follow-up due: ' + task.description,
              read: false,
            },
          },
          { upsert: true },
        )
        publish(task.workspaceId)
      }
      await FollowUp.updateOne(
        { _id: task._id, workspaceId: task.workspaceId, dueAt: task.dueAt },
        { notifiedAt: new Date() },
      )
    }
  }
  function poll() {
    if (!scanning)
      scanning = scan()
        .catch(() => console.error('Could not scan Relay jobs.'))
        .finally(() => {
          scanning = undefined
        })
  }
  poll()
  const timer = setInterval(poll, 2500)
  return async () => {
    clearInterval(timer)
    await scanning
    await worker.close()
    await queue.close()
  }
}
