import { Router } from 'express'
import { z } from 'zod'
import { env, required } from './config.js'
import { seal, unseal } from './security.js'
import { FacebookForm, FacebookPage, Integration, Template, WebhookEvent } from './models.js'
import { failure, manager, publish } from './runtime.js'
import { providerId } from './validation.js'
import { graph, graphList, tokenResult } from './graph.js'
import { facebookConnect, facebookReady } from './facebook-oauth.js'
import { isSheetAdmin } from './sheet-sources.js'
import { registerEvent } from './webhooks.js'
export { metaCallback } from './facebook-oauth.js'
export const integrations = Router()
integrations.use('/facebook', facebookConnect)
integrations.get('/', async (req, res) => {
  res.json({
    rows: await Integration.find({ workspaceId: req.workspaceId }).lean(),
    googleSheetsAdmin:
      (req.role === 'admin' || req.role === 'owner') && (await isSheetAdmin(req.userId)),
    facebookReady: facebookReady(),
    whatsappAppId: env.META_APP_ID || '',
    whatsappConfigId: env.META_WHATSAPP_CONFIG_ID || '',
    graphVersion: env.META_GRAPH_VERSION || '',
    mediaEnabled: Boolean(env.MEDIA_ORIGIN),
    testNumberEnabled:
      env.NODE_ENV !== 'production' &&
      Boolean(env.META_TEST_TOKEN && env.META_TEST_PHONE_ID && env.META_TEST_WABA_ID),
  })
})
integrations.get('/:provider/status', async (req, res) => {
  const provider = z.enum(['facebook', 'whatsapp']).parse(req.params.provider)
  res.json({ row: await Integration.findOne({ workspaceId: req.workspaceId, provider }) })
})
integrations.get('/logs', async (req, res) => {
  manager(req)
  res.json(
    await WebhookEvent.find({ workspaceId: req.workspaceId })
      .select('provider status createdAt')
      .sort('-createdAt')
      .limit(30),
  )
})
integrations.get('/facebook/pages', async (req, res) => {
  manager(req)
  res.json(await FacebookPage.find({ workspaceId: req.workspaceId }).sort('name'))
})
export async function pageToken(workspaceId: string, pageId: string) {
  const page = await FacebookPage.findOne({ workspaceId, externalId: pageId }).select('+credential')
  if (!page?.credential || !(await Integration.exists({ workspaceId, provider: 'facebook' })))
    return failure(404, 'Connect the Facebook Page first.')
  return unseal(page.credential)
}
integrations.get('/facebook/forms', async (req, res) => {
  manager(req)
  const pageId = providerId.parse(req.query.pageId)
  const rows = await graphList<{ id: string; name: string }>(
    pageId + '/leadgen_forms',
    await pageToken(req.workspaceId, pageId),
    'id,name',
  )
  const selected = await FacebookForm.distinct('externalId', {
    workspaceId: req.workspaceId,
    pageId,
    selected: true,
  })
  res.json(rows.map((row) => ({ ...row, selected: selected.includes(row.id) })))
})
integrations.post('/facebook/forms', async (req, res) => {
  manager(req)
  const { pageId, formIds } = z
    .object({ pageId: providerId, formIds: z.array(providerId).max(100) })
    .parse(req.body)
  const token = await pageToken(req.workspaceId, pageId)
  const forms = await graphList<{ id: string; name: string }>(
    pageId + '/leadgen_forms',
    token,
    'id,name',
  )
  if (formIds.some((id) => !forms.some((form) => form.id === id)))
    return failure(400, 'Select forms from the authorized Page.')
  if (formIds.length)
    await graph(pageId + '/subscribed_apps', token, {}, { subscribed_fields: 'leadgen' })
  const scope = { workspaceId: req.workspaceId, pageId }
  for (const form of forms.filter((form) => formIds.includes(form.id)))
    await FacebookForm.updateOne(
      { ...scope, externalId: form.id },
      { name: form.name, selected: true },
      { upsert: true },
    )
  await FacebookForm.updateMany({ ...scope, externalId: { $nin: formIds } }, { selected: false })
  res.json({ ok: true })
})
integrations.post('/facebook/sync', async (req, res) => {
  manager(req)
  const forms = await FacebookForm.find({ workspaceId: req.workspaceId, selected: true })
  if (!forms.length) return failure(400, 'Select at least one lead form.')
  const eventKey = req.workspaceId + ':sync:' + Date.now()
  await registerEvent(req.workspaceId, 'facebook-sync', eventKey, {})
  res.status(202).json({ queued: true })
})
export async function syncFacebook(workspaceId: string) {
  const forms = await FacebookForm.find({ workspaceId, selected: true })
  for (const form of forms) {
    if (!form.pageId || !form.externalId) continue
    const leads = await graphList<{ id: string }>(
      form.externalId + '/leads',
      await pageToken(workspaceId, form.pageId),
      'id',
    )
    for (const lead of leads)
      await registerEvent(workspaceId, 'facebook', workspaceId + ':' + lead.id, {
        pageId: form.pageId,
        formId: form.externalId,
        leadId: lead.id,
        historical: true,
      })
  }
  await Integration.updateOne({ workspaceId, provider: 'facebook' }, { lastSyncAt: new Date() })
}
async function linkWhatsapp(
  workspaceId: string,
  accountId: string,
  phoneId: string,
  token: string,
  pin?: string,
) {
  const phones = await graphList<{ id: string; display_phone_number: string }>(
    accountId + '/phone_numbers',
    token,
    'id,display_phone_number',
  )
  const phone = phones.find((row) => row.id === phoneId)
  if (!phone) return failure(400, 'This phone number does not belong to the authorized account.')
  const reserved = await Integration.findOne({ provider: 'whatsapp', phoneId }).lean()
  if (reserved && reserved.workspaceId !== workspaceId)
    return failure(409, 'This phone number is already connected.')
  if (pin) await graph(phoneId + '/register', token, {}, { messaging_product: 'whatsapp', pin })
  await graph(accountId + '/subscribed_apps', token, {}, {})
  const existing = await Integration.findOne({ workspaceId, provider: 'whatsapp' }).lean()
  if (existing && existing.accountId !== accountId)
    await Template.updateMany(
      { workspaceId, externalId: { $type: 'string' } },
      { $set: { status: 'draft' }, $unset: { externalId: 1 } },
    )
  await Integration.updateOne(
    { workspaceId, provider: 'whatsapp' },
    { accountId, phoneId, label: phone.display_phone_number, credential: seal(token) },
    { upsert: true },
  )
  publish(workspaceId)
}
integrations.post('/whatsapp/connect', async (req, res) => {
  manager(req)
  if (req.body.test === true && env.NODE_ENV !== 'production') {
    await linkWhatsapp(
      req.workspaceId,
      providerId.parse(required('META_TEST_WABA_ID')),
      providerId.parse(required('META_TEST_PHONE_ID')),
      required('META_TEST_TOKEN'),
    )
  } else {
    const input = z
      .object({
        code: z.string().min(1).max(4000),
        accountId: providerId,
        phoneId: providerId,
        pin: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      })
      .parse(req.body)
    const result = tokenResult.parse(
      await graph('oauth/access_token', undefined, {
        client_id: required('META_APP_ID'),
        client_secret: required('META_APP_SECRET'),
        code: input.code,
      }),
    )
    await linkWhatsapp(
      req.workspaceId,
      input.accountId,
      input.phoneId,
      result.access_token,
      input.pin,
    )
  }
  res.json({ ok: true })
})
integrations.post('/:provider/disconnect', async (req, res) => {
  manager(req)
  const provider = z.enum(['facebook', 'whatsapp']).parse(req.params.provider)
  await Integration.deleteOne({ workspaceId: req.workspaceId, provider })
  if (provider === 'facebook') {
    await FacebookForm.updateMany({ workspaceId: req.workspaceId }, { selected: false })
    await FacebookPage.deleteMany({ workspaceId: req.workspaceId })
  } else
    await Template.updateMany(
      { workspaceId: req.workspaceId, externalId: { $type: 'string' } },
      { $set: { status: 'draft' }, $unset: { externalId: 1 } },
    )
  publish(req.workspaceId)
  res.json({ ok: true })
})
