import mongoose from 'mongoose'
import { z } from 'zod'
import {
  Activity,
  Conversation,
  FacebookForm,
  Integration,
  Lead,
  Message,
  WebhookEvent,
} from './models.js'
import { env } from './config.js'
import { graph } from './graph.js'
import { pageToken, syncFacebook } from './integrations.js'
import { publish, schedule } from './runtime.js'
import { inbound, delivery } from './webhooks.js'
import { id, providerId } from './validation.js'

export function normalizeLead(answers: Record<string, string[]>, id: string) {
  const first = (key: string) => answers[key]?.[0]?.trim() || ''
  const number = (first('phone_number') || first('phone')).replace(/[\s().-]/g, '')
  return {
    name: (
      first('full_name') ||
      [first('first_name'), first('last_name')].filter(Boolean).join(' ') ||
      'Lead ' + id
    ).slice(0, 160),
    phone: /^\+[1-9]\d{7,14}$/.test(number) ? number : undefined,
    email: first('email').slice(0, 254),
    company: first('company_name') || first('company'),
    answers,
  }
}
async function facebookLead(workspaceId: string, value: unknown, eventKey: string) {
  const { pageId, formId, leadId, historical } = z
    .object({
      pageId: providerId,
      formId: providerId,
      leadId: providerId,
      historical: z.boolean().optional(),
    })
    .parse(value)
  const form = await FacebookForm.findOne({
    workspaceId,
    pageId,
    externalId: formId,
    selected: true,
  })
  if (!form) return
  const fetched = await graph<{
    field_data?: { name: string; values: string[] }[]
    campaign_name?: string
    platform?: string
  }>(leadId, await pageToken(workspaceId, pageId), {
    fields: 'id,field_data,campaign_name,platform',
  })
  const answers = Object.fromEntries(
    (fetched.field_data || []).map((item) => [item.name, item.values]),
  )
  const source = fetched.platform === 'ig' ? 'Instagram' : 'Facebook'
  const consentAllowed =
    env.META_OPT_IN_FORM_ID === formId &&
    !!env.META_OPT_IN_FIELD &&
    !!env.META_OPT_IN_ACCEPTED_VALUE &&
    answers[env.META_OPT_IN_FIELD]?.[0] === env.META_OPT_IN_ACCEPTED_VALUE
  const consent = consentAllowed && !historical ? 'granted' : 'unknown'
  const row = await Lead.findOneAndUpdate(
    { workspaceId, source, externalId: leadId },
    {
      $setOnInsert: {
        ...normalizeLead(answers, leadId),
        pageId,
        formId,
        campaign: fetched.campaign_name,
        status: 'New',
        consent,
        consentAt: consent === 'granted' ? new Date() : undefined,
      },
    },
    { upsert: true, new: true },
  )
  if (!row) return
  await Activity.updateOne(
    { workspaceId, eventKey },
    {
      $setOnInsert: {
        leadId: String(row._id),
        kind: 'lead.imported',
        detail: 'Lead imported from ' + source,
      },
    },
    { upsert: true },
  )
  if (!historical) await schedule(workspaceId, String(row._id), 'lead.imported', eventKey, formId)
  await Integration.updateOne({ workspaceId, provider: 'facebook' }, { lastSyncAt: new Date() })
}
const order: Record<string, number> = {
  queued: 0,
  sending: 0,
  unknown: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}
export function canApplyStatus(current: string, incoming: string) {
  if (incoming === 'failed') return order[current] < 2
  if (current === 'failed') return incoming === 'delivered' || incoming === 'read'
  return order[incoming] > order[current]
}
async function whatsappEvent(workspaceId: string, value: unknown) {
  const event = z
    .object({ phoneId: providerId, message: inbound.optional(), status: delivery.optional() })
    .parse(value)
  if (!(await Integration.exists({ workspaceId, provider: 'whatsapp', phoneId: event.phoneId })))
    return
  if (event.status) {
    const receipt = event.status
    const callback = id.safeParse(receipt.biz_opaque_callback_data)
    const row = await Message.findOne({
      workspaceId,
      direction: 'outbound',
      providerPhoneId: event.phoneId,
      $or: [{ externalId: receipt.id }, ...(callback.success ? [{ _id: callback.data }] : [])],
    })
    if (!row) throw new Error('Outbound message is not recorded yet.')
    if (canApplyStatus(row.status || 'queued', receipt.status))
      await Message.updateOne(
        { _id: row._id, workspaceId, status: row.status },
        {
          status: receipt.status,
          externalId: receipt.id,
          providerTimestamp: new Date(Number(receipt.timestamp) * 1000),
        },
      )
    return
  }
  if (!event.message) return
  const message = event.message
  const phone = '+' + message.from
  const text = message.text?.body || message.image?.caption || message.document?.filename || ''
  const time = new Date(Number(message.timestamp) * 1000)
  if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now() + 300_000) return
  await mongoose.connection.transaction(async (session) => {
    if (await Message.exists({ workspaceId, externalId: message.id }).session(session)) return
    const optedOut = /^(stop|unsubscribe|opt out)$/i.test(text.trim())
    if (optedOut)
      await Lead.updateMany({ workspaceId, phone }, { consent: 'opted_out' }, { session })
    const existing = await Conversation.findOne({ workspaceId, phone }).session(session)
    let lead = existing?.leadId
      ? await Lead.findOne({ workspaceId, _id: existing.leadId, archivedAt: null }).session(session)
      : await Lead.findOne({ workspaceId, phone, archivedAt: null })
          .sort('-createdAt')
          .session(session)
    if (existing?.leadId && !lead) return
    if (!lead)
      [lead] = await Lead.create(
        [
          {
            workspaceId,
            phone,
            name: phone,
            source: 'WhatsApp',
            status: 'New',
            consent: optedOut ? 'opted_out' : 'unknown',
          },
        ],
        { session },
      )
    const leadId = String(lead._id)
    const chat = await Conversation.findOneAndUpdate(
      { workspaceId, phone },
      {
        $set: {
          lastMessage: text,
          status: 'open',
          lastInboundPhoneId: event.phoneId,
          ...(existing?.lastInboundPhoneId !== event.phoneId && { lastInboundAt: time }),
        },
        $setOnInsert: { leadId },
        ...(existing?.lastInboundPhoneId === event.phoneId && { $max: { lastInboundAt: time } }),
        $inc: { unread: 1 },
      },
      { upsert: true, new: true, session, setDefaultsOnInsert: false },
    )
    if (!chat) return
    await Message.create(
      [
        {
          workspaceId,
          conversationId: String(chat._id),
          externalId: message.id,
          direction: 'inbound',
          providerPhoneId: event.phoneId,
          type: message.type,
          text,
          mediaId: message.image?.id || message.document?.id,
          status: 'received',
          providerTimestamp: time,
        },
      ],
      { session },
    )
    await Activity.create(
      [{ workspaceId, leadId, kind: 'message.received', detail: 'WhatsApp message received' }],
      { session },
    )
  })
}
export async function processEvent(eventId: string) {
  const event = await WebhookEvent.findOne({ _id: eventId, status: 'pending' }).lean()
  if (!event?.workspaceId) return
  const { workspaceId } = event
  if (event.provider === 'facebook')
    await facebookLead(workspaceId, event.payload, event.eventKey || eventId)
  if (event.provider === 'facebook-sync') await syncFacebook(workspaceId)
  if (event.provider === 'whatsapp') await whatsappEvent(workspaceId, event.payload)
  await WebhookEvent.updateOne({ _id: eventId }, { status: 'processed', $unset: { payload: 1 } })
  publish(workspaceId)
}
