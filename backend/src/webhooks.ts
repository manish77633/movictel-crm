import { Router } from 'express'
import { z } from 'zod'
import { required } from './config.js'
import { equal, validSignature } from './security.js'
import { FacebookForm, Integration, WebhookEvent } from './models.js'
import { failure } from './runtime.js'
import { providerId } from './validation.js'
export const webhooks = Router()
export async function registerEvent(
  workspaceId: string,
  provider: string,
  eventKey: string,
  payload: object,
) {
  try {
    await WebhookEvent.updateOne(
      { provider, eventKey },
      { $setOnInsert: { payload, status: 'pending', workspaceId } },
      { upsert: true },
    )
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
  }
}
webhooks.get('/:provider', (req, res) => {
  z.enum(['facebook', 'whatsapp']).parse(req.params.provider)
  if (
    req.query['hub.mode'] !== 'subscribe' ||
    typeof req.query['hub.verify_token'] !== 'string' ||
    !equal(req.query['hub.verify_token'], required('META_WEBHOOK_TOKEN'))
  )
    return failure(403, 'Verification failed.')
  res.type('text/plain').send(z.string().max(128).parse(req.query['hub.challenge']))
})
const facebookEvent = z.object({ leadgen_id: providerId, form_id: providerId, page_id: providerId })
export const inbound = z.object({
  id: z.string().min(1).max(250),
  from: providerId,
  timestamp: providerId,
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: providerId, caption: z.string().optional() }).optional(),
  document: z.object({ id: providerId, filename: z.string().optional() }).optional(),
})
export const delivery = z.object({
  id: z.string().min(1).max(250),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: providerId,
  biz_opaque_callback_data: z.string().optional(),
})
const whatsappValue = z.object({
  metadata: z.object({ phone_number_id: providerId }),
  messages: z.array(inbound).optional(),
  statuses: z.array(delivery).optional(),
})
webhooks.post('/:provider', async (req, res) => {
  const provider = z.enum(['facebook', 'whatsapp']).parse(req.params.provider)
  if (
    !Buffer.isBuffer(req.body) ||
    !validSignature(req.body, req.header('x-hub-signature-256') || '', required('META_APP_SECRET'))
  )
    return failure(403, 'Signature verification failed.')
  let payload: unknown
  try {
    payload = JSON.parse(req.body.toString('utf8'))
  } catch {
    return failure(400, 'Invalid JSON.')
  }
  const event = z
    .object({
      object: z.string(),
      entry: z.array(
        z.object({
          changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
        }),
      ),
    })
    .parse(payload)
  for (const entry of event.entry)
    for (const change of entry.changes ?? []) {
      if (provider === 'facebook' && event.object === 'page' && change.field === 'leadgen') {
        const item = facebookEvent.safeParse(change.value)
        if (!item.success) continue
        const { page_id: pageId, form_id: formId, leadgen_id: leadId } = item.data
        const form = await FacebookForm.findOne({
          pageId,
          externalId: formId,
          selected: true,
        }).lean()
        if (form?.workspaceId)
          await registerEvent(form.workspaceId, provider, form.workspaceId + ':' + leadId, {
            pageId,
            formId,
            leadId,
          })
      }
      if (
        provider === 'whatsapp' &&
        event.object === 'whatsapp_business_account' &&
        change.field === 'messages'
      ) {
        const item = whatsappValue.safeParse(change.value)
        if (!item.success) continue
        const phoneId = item.data.metadata.phone_number_id
        const integration = await Integration.findOne({ provider, phoneId }).lean()
        if (!integration?.workspaceId) continue
        for (const message of item.data.messages ?? [])
          await registerEvent(integration.workspaceId, provider, phoneId + ':in:' + message.id, {
            phoneId,
            message,
          })
        for (const status of item.data.statuses ?? [])
          await registerEvent(
            integration.workspaceId,
            provider,
            phoneId + ':out:' + status.id + ':' + status.status,
            { phoneId, status },
          )
      }
    }
  res.sendStatus(200)
})
