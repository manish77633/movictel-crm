import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import mongoose from 'mongoose'
import { app } from './app.js'
import {
  models,
  Lead,
  Member,
  User,
  SheetConnection,
  Automation,
  Execution,
  FacebookPage,
  FacebookForm,
  Integration,
  Message,
  WebhookEvent,
} from './models.js'
import { canApplyStatus, normalizeLead, processEvent } from './incoming.js'
import {
  messagingError,
  passwordHash,
  validPassword,
  validSignature,
  seal,
  unseal,
} from './security.js'
import { variablesIn } from './messaging.js'
import { deliver } from './worker.js'
import { prepareSheetConnections, syncDueSheets } from './sheet-sources.js'

test('checks signed bytes and rejects tampered webhook bodies', () => {
  const raw = Buffer.from('{"object":"page"}')
  const key = 'synthetic-key'
  const signature = 'sha256=' + createHmac('sha256', key).update(raw).digest('hex')
  assert.equal(validSignature(raw, signature, key), true)
  assert.equal(validSignature(Buffer.concat([raw, Buffer.from(' ')]), signature, key), false)
  assert.equal(validSignature(raw, '', key), false)
})
test('checks opt-out, template consent and the exact customer service boundary', () => {
  const now = Date.now()
  assert.ok(messagingError('opted_out', new Date(now), true, now))
  assert.ok(messagingError('unknown', new Date(now), true, now))
  assert.equal(messagingError('granted', undefined, true, now), undefined)
  assert.equal(messagingError('unknown', new Date(now - 86399999), false, now), undefined)
  assert.ok(messagingError('unknown', new Date(now - 86400000), false, now))
})
test('normalizes provider leads without inferring consent', () => {
  const answers = {
    first_name: ['Mira'],
    last_name: ['Patel'],
    phone_number: ['+1 (202) 555-0136'],
    question: ['A custom answer'],
  }
  const lead = normalizeLead(answers, '123')
  assert.equal(lead.name, 'Mira Patel')
  assert.equal(lead.phone, '+12025550136')
  assert.deepEqual(lead.answers, answers)
  assert.equal(normalizeLead({ phone_number: ['02012345'] }, '123').phone, undefined)
})
test('does not move message receipts backwards', () => {
  assert.equal(canApplyStatus('read', 'delivered'), false)
  assert.equal(canApplyStatus('delivered', 'failed'), false)
  assert.equal(canApplyStatus('unknown', 'sent'), true)
  assert.equal(canApplyStatus('failed', 'read'), true)
})
test('hashes password and encrypts credentials with authenticated encryption', () => {
  const password = 'synthetic-password-123'
  assert.equal(validPassword(password, passwordHash(password)), true)
  assert.equal(validPassword('unrelated-password', passwordHash(password)), false)
  process.env.CREDENTIAL_KEY = Buffer.alloc(32, 42).toString('base64')
  assert.equal(unseal(seal('synthetic-credential')), 'synthetic-credential')
})
test('reads and sorts numbered template variables', () => {
  assert.deepEqual(variablesIn('Hi {{2}}, {{1}} and {{2}}'), [1, 2])
  assert.deepEqual(variablesIn('Hi customer'), [])
})
test('verifies webhook subscriptions and rejects invalid signatures over HTTP', async () => {
  process.env.META_WEBHOOK_TOKEN = 'test-verify'
  process.env.META_APP_SECRET = 'test-secret'
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = 'http://127.0.0.1:' + address.port + '/api/v1/webhooks/facebook'
  try {
    const verified = await fetch(
      endpoint + '?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123',
    )
    assert.equal(verified.status, 200)
    assert.equal(await verified.text(), '123')
    const rejected = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'invalid' },
      body: '{"object":"page","entry":[]}',
    })
    assert.equal(rejected.status, 403)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
test(
  'registration, sessions, lead isolation, duplicate IDs and automation cancellation',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const dbName = 'relay_test_' + Date.now()
    process.env.ACCESS_SECRET = 'synthetic-test-secret-only'
    process.env.LOCAL_SKIP_EMAIL = 'true'
    await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName })
    await Promise.all(models.map((model) => model.init()))
    await SheetConnection.collection.createIndex({ workspaceId: 1 }, { unique: true })
    await prepareSheetConnections()
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const origin = 'http://127.0.0.1:' + address.port + '/api/v1'
    async function request(
      path: string,
      options: { method?: string; body?: unknown; cookies?: string; workspace?: string } = {},
    ) {
      return fetch(origin + path, {
        method: options.method,
        headers: {
          ...(options.body !== undefined && { 'content-type': 'application/json' }),
          ...(options.cookies && { cookie: options.cookies }),
          ...(options.workspace && { 'x-workspace-id': options.workspace }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    }
    const cookieFrom = (headers: Headers) =>
      headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ')
    async function register(label: string) {
      const body = {
        name: label,
        business: label + ' business',
        email: label.toLowerCase() + '@example.test',
        password: 'synthetic-test-password',
      }
      const result = await request('/auth/register', { method: 'POST', body })
      assert.equal(result.status, 201)
      const loggedIn = await request('/auth/login', { method: 'POST', body })
      assert.equal(loggedIn.status, 200)
      const cookies = cookieFrom(loggedIn.headers)
      const listed = await request('/workspaces', { cookies })
      const { rows, user } = await listed.json()
      return { cookies, workspace: rows[0]._id, userId: user._id }
    }
    try {
      const first = await register('First'),
        second = await register('Second')
      const created = await request('/leads', {
        ...first,
        method: 'POST',
        body: { name: 'Synthetic lead', phone: '+12025550134' },
      })
      assert.equal(created.status, 201)
      const row = await created.json()
      assert.equal((await request('/leads/' + row._id, second)).status, 404)
      assert.equal((await request('/leads', { ...second, workspace: first.workspace })).status, 403)
      await Member.create({ workspaceId: first.workspace, userId: second.userId, role: 'agent' })
      assert.equal(
        (await request('/leads/' + row._id, { ...second, workspace: first.workspace })).status,
        404,
      )
      assert.equal(
        (
          await request('/leads/' + row._id + '/assign', {
            ...first,
            method: 'POST',
            body: { userId: second.userId },
          })
        ).status,
        200,
      )
      assert.equal(
        (await request('/leads/' + row._id, { ...second, workspace: first.workspace })).status,
        200,
      )
      const third = await register('Third')
      const legacySheet = await SheetConnection.create({
        workspaceId: third.workspace,
        spreadsheetId: 'legacy-sheet',
        sheetId: 1,
        tabName: 'Existing campaign',
        lastAttemptAt: new Date(),
      })
      const legacyLead = await Lead.create({
        workspaceId: third.workspace,
        source: 'Google Sheets',
        externalId: 'legacy-id',
        name: 'Existing lead',
        status: 'Interested',
      })
      await prepareSheetConnections()
      const migrated = await Lead.findById(legacyLead.id).lean()
      assert.equal(migrated?.campaignSheetId, legacySheet.id)
      assert.equal(migrated?.externalId, 'legacy-id')
      assert.equal(migrated?.status, 'Interested')
      await Member.create({ workspaceId: first.workspace, userId: third.userId, role: 'client' })
      await Member.create({ workspaceId: second.workspace, userId: first.userId, role: 'admin' })
      const client = { ...third, workspace: first.workspace }
      const sheets = '/integrations/google-sheets'
      const sheetLink = { url: 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit#gid=9' }
      process.env.GOOGLE_SHEETS_ADMIN_EMAILS = 'first@example.test'
      const clientAccount = {
        action: 'create',
        email: 'managed-client@example.test',
        name: 'Managed client',
        password: 'synthetic-client-password',
      }
      const createClient = { method: 'POST', body: clientAccount }
      assert.equal((await request('/team/clients', { ...client, ...createClient })).status, 403)
      assert.equal((await request('/team/clients', { ...first, ...createClient })).status, 201)
      const signedIn = await request('/auth/login', createClient)
      assert.equal(signedIn.status, 200)
      const managed = { cookies: cookieFrom(signedIn.headers) }
      assert.equal(
        (await request('/leads', { ...managed, workspace: first.workspace })).status,
        200,
      )
      assert.equal(
        (await request('/leads', { ...managed, workspace: second.workspace })).status,
        403,
      )
      const otherWorkspace = { ...first, workspace: second.workspace }
      assert.equal(
        (
          await request('/team/clients', {
            ...otherWorkspace,
            method: 'POST',
            body: { action: 'grant', email: clientAccount.email },
          })
        ).status,
        201,
      )
      assert.equal(
        (await request('/leads', { ...managed, workspace: second.workspace })).status,
        200,
      )
      const managedUser = await User.findOne({ email: clientAccount.email })
      const managedMembership = await Member.findOne({
        userId: managedUser?.id,
        workspaceId: second.workspace,
      })
      assert.ok(managedMembership)
      assert.equal(
        (await request('/team/' + managedMembership.id, { ...otherWorkspace, method: 'DELETE' }))
          .status,
        200,
      )
      assert.equal(
        (await request('/leads', { ...managed, workspace: second.workspace })).status,
        403,
      )
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'synthetic@example.test'
      process.env.GOOGLE_SHEETS_PRIVATE_KEY = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        publicKeyEncoding: { format: 'pem', type: 'spki' },
      }).privateKey
      const networkFetch = globalThis.fetch
      let sheetName = 'Sheet test lead'
      let appended = false
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input))
        if (url.hostname === 'oauth2.googleapis.com')
          return Response.json({ access_token: 'synthetic', expires_in: 3600 })
        if (url.hostname !== 'sheets.googleapis.com') return networkFetch(input, init)
        if (url.pathname.includes('/values/')) {
          assert.ok(decodeURIComponent(url.pathname).endsWith("/values/'Leads'"))
          return Response.json({
            values: [
              ['id', 'full_name', 'phone_number', 'Preferred location'],
              ['l:10000000000000009', sheetName, 'p:+1 (202) 555-0123', 'South'],
              ...(appended && url.pathname.includes('/synthetic-sheet/')
                ? [['new-lead', 'New sheet row', '+12025550125', 'North']]
                : []),
            ],
          })
        }
        return Response.json({ sheets: [{ properties: { sheetId: 9, title: 'Leads', index: 0 } }] })
      }
      try {
        assert.equal(
          (await request(sheets, { ...second, method: 'POST', body: sheetLink })).status,
          403,
        )
        assert.equal(
          (await request(sheets, { ...client, method: 'POST', body: sheetLink })).status,
          403,
        )
        assert.equal(
          (await request(sheets, { ...first, method: 'POST', body: sheetLink })).status,
          201,
        )
        assert.equal(
          (
            await request(sheets, {
              ...first,
              workspace: second.workspace,
              method: 'POST',
              body: sheetLink,
            })
          ).status,
          409,
        )
        const firstSync = await request(sheets + '/sync', { ...first, method: 'POST' })
        assert.equal(firstSync.status, 200)
        assert.deepEqual(await firstSync.json(), { imported: 1, skipped: 0 })
        const result = await request('/leads?source=Google%20Sheets', client)
        const { rows } = await result.json()
        assert.equal(rows.length, 1)
        assert.equal(rows[0].phone, '+12025550123')
        const path = '/leads/' + rows[0]._id
        for (const member of [client, first]) {
          assert.equal((await request(path, member)).status, 200)
        }
        assert.equal((await request(path, second)).status, 404)
        assert.equal(
          (
            await request(path, {
              ...third,
              workspace: second.workspace,
              method: 'PATCH',
              body: { name: 'Denied' },
            })
          ).status,
          403,
        )
        assert.equal(
          (
            await request(path + '/status', {
              ...client,
              method: 'PATCH',
              body: { status: 'Interested' },
            })
          ).status,
          200,
        )
        assert.equal(
          (
            await request(path + '/notes', {
              ...client,
              method: 'POST',
              body: { text: 'Client note' },
            })
          ).status,
          201,
        )
        const task = {
          leadId: rows[0]._id,
          description: 'Client callback',
          dueAt: new Date(Date.now() + 3600_000).toISOString(),
        }
        assert.equal(
          (await request('/followups', { ...client, method: 'POST', body: task })).status,
          201,
        )
        assert.equal(
          (await request('/followups', { ...second, method: 'POST', body: task })).status,
          404,
        )
        sheetName = 'Changed in Google Sheets'
        const retry = await request(sheets + '/sync', { ...first, method: 'POST' })
        assert.deepEqual(await retry.json(), { imported: 0, skipped: 0 })
        const stored = await (await request(path, first)).json()
        assert.equal(stored.row.status, 'Interested')
        assert.equal(stored.row.name, 'Sheet test lead')
        assert.equal(stored.notes[0].text, 'Client note')
        assert.ok(
          stored.row.sheetFields.some(
            (field: { label: string; value: string }) =>
              field.label === 'Preferred location' && field.value === 'South',
          ),
        )

        for (const campaignName of ['Second campaign', 'Third campaign']) {
          const url =
            'https://docs.google.com/spreadsheets/d/' +
            campaignName.replaceAll(' ', '-') +
            '/edit#gid=9'
          assert.equal(
            (
              await request(sheets, {
                ...first,
                method: 'POST',
                body: { url, campaignName },
              })
            ).status,
            201,
          )
        }
        const list = await (await request('/campaign-sheets', client)).json()
        assert.equal(list.length, 3)
        assert.ok(list.every((entry: { spreadsheetId?: string }) => !entry.spreadsheetId))
        assert.equal((await (await request('/campaign-sheets', second)).json()).length, 0)
        const imported = await request(sheets + '/sync', { ...client, method: 'POST' })
        assert.deepEqual(await imported.json(), { imported: 2, skipped: 0 })
        const combined = await (await request('/leads?source=Google%20Sheets', client)).json()
        assert.equal(combined.total, 3)
        assert.equal(
          new Set(combined.rows.map((lead: { campaignSheetId: string }) => lead.campaignSheetId))
            .size,
          3,
        )
        const filtered = await (
          await request('/dashboard/overview?campaignSheetId=' + list[1]._id, client)
        ).json()
        assert.equal(filtered.recent.length, 1)
        assert.equal(filtered.recent[0].campaignSheetName, 'Second campaign')

        appended = true
        await SheetConnection.updateOne(
          { spreadsheetId: 'synthetic-sheet' },
          {
            lastAttemptAt: new Date(Date.now() - 5 * 60_000 - 1000),
          },
        )
        await syncDueSheets((message) => assert.fail(message))
        const refreshed = await (
          await request('/leads?campaignSheetId=' + list[0]._id, client)
        ).json()
        assert.equal(refreshed.total, 2)
        assert.ok(refreshed.rows.some((lead: { name: string }) => lead.name === 'New sheet row'))

        const firstClient = await Member.findOne({
          userId: third.userId,
          workspaceId: first.workspace,
        })
        const secondClient = await Member.findOne({
          userId: managedUser!.id,
          workspaceId: first.workspace,
        })
        assert.ok(firstClient && secondClient)
        const setCampaigns = (memberId: string, campaignSheetIds: string[] | null) =>
          request('/team/clients/' + memberId, {
            ...first,
            method: 'PATCH',
            body: { campaignSheetIds },
          })
        assert.equal((await setCampaigns(firstClient.id, [legacySheet.id])).status, 400)
        assert.equal((await setCampaigns(firstClient.id, [list[0]._id, list[1]._id])).status, 200)
        assert.equal((await setCampaigns(secondClient.id, [list[2]._id])).status, 200)
        assert.equal((await (await request('/campaign-sheets', client)).json()).length, 2)
        const otherClient = { ...managed, workspace: first.workspace }
        assert.equal((await (await request('/campaign-sheets', otherClient)).json()).length, 1)
        assert.equal(
          (await (await request('/leads?campaignSheetId=' + list[0]._id, otherClient)).json())
            .total,
          0,
        )
        assert.equal((await request(path, otherClient)).status, 404)
        assert.equal((await request('/followups', otherClient)).status, 200)
        assert.equal(
          (
            await request(sheets + '/sync', {
              ...otherClient,
              method: 'POST',
              body: { campaignSheetId: list[0]._id },
            })
          ).status,
          404,
        )
        assert.equal(
          (await request(sheets + '/' + list[2]._id, { ...otherClient, method: 'DELETE' })).status,
          403,
        )
        assert.equal(
          (await request(sheets + '/' + list[2]._id, { ...first, method: 'DELETE' })).status,
          200,
        )
        assert.equal((await (await request('/leads', otherClient)).json()).total, 0)
        assert.equal((await (await request('/campaign-sheets', otherClient)).json()).length, 0)
        assert.equal(
          (
            await request('/team/clients/' + firstClient.id + '/account', {
              ...first,
              method: 'DELETE',
            })
          ).status,
          403,
        )
        assert.equal(
          (
            await request('/team/clients/' + secondClient.id + '/account', {
              ...first,
              method: 'DELETE',
            })
          ).status,
          200,
        )
        assert.equal((await request('/workspaces', managed)).status, 401)
        assert.equal((await setCampaigns(firstClient.id, null)).status, 200)

        const createdWorkspace = await request('/workspaces', {
          ...first,
          method: 'POST',
          body: { name: 'Delete test' },
        })
        assert.equal(createdWorkspace.status, 201)
        const workspace = (await createdWorkspace.json())._id
        assert.equal(
          (await request('/workspaces/' + workspace, { ...first, workspace, method: 'DELETE' }))
            .status,
          200,
        )
        assert.equal((await request('/leads', { ...first, workspace })).status, 403)
      } finally {
        globalThis.fetch = networkFetch
      }

      const rule = await Automation.create({
        workspaceId: first.workspace,
        trigger: 'lead.status',
        name: 'Reminder',
        action: 'notification',
        enabled: true,
        delay: 30,
      })
      assert.equal(
        (
          await request('/leads/' + row._id + '/status', {
            ...first,
            method: 'PATCH',
            body: { status: 'Interested' },
          })
        ).status,
        200,
      )
      assert.equal(
        await Execution.countDocuments({
          workspaceId: first.workspace,
          automationId: String(rule._id),
          status: 'pending',
        }),
        1,
      )
      assert.equal(
        (
          await request('/automations/' + rule._id, {
            ...first,
            method: 'PATCH',
            body: { enabled: false },
          })
        ).status,
        200,
      )
      assert.equal(
        await Execution.countDocuments({
          workspaceId: first.workspace,
          automationId: String(rule._id),
          status: 'cancelled',
        }),
        1,
      )
      const imported = {
        workspaceId: first.workspace,
        source: 'Facebook',
        externalId: '123',
        name: 'Imported',
      }
      await Lead.create(imported)
      await assert.rejects(() => Lead.create(imported), { code: 11000 })
      await FacebookPage.create({
        workspaceId: first.workspace,
        externalId: '300',
        credential: seal('synthetic-provider-token'),
      })
      await FacebookForm.create({
        workspaceId: first.workspace,
        pageId: '300',
        externalId: '400',
        selected: true,
      })
      await Integration.create({ workspaceId: first.workspace, provider: 'facebook' })
      await Integration.create({
        workspaceId: first.workspace,
        provider: 'whatsapp',
        accountId: '500',
        phoneId: '600',
        credential: seal('synthetic-whatsapp-token'),
      })
      process.env.META_GRAPH_VERSION = 'v27.0'
      async function webhook(provider: string, body: unknown) {
        const bytes = JSON.stringify(body)
        const signature =
          'sha256=' + createHmac('sha256', process.env.META_APP_SECRET!).update(bytes).digest('hex')
        return fetch(origin + '/webhooks/' + provider, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
          body: bytes,
        })
      }
      const event = {
        object: 'page',
        entry: [
          {
            changes: [
              { field: 'leadgen', value: { page_id: '300', form_id: '400', leadgen_id: '700' } },
            ],
          },
        ],
      }
      assert.equal((await webhook('facebook', event)).status, 200)
      assert.equal((await webhook('facebook', event)).status, 200)
      const events = await WebhookEvent.find({ provider: 'facebook', workspaceId: first.workspace })
      assert.equal(events.length, 1)
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (input) => {
        assert.equal(new URL(String(input)).hostname, 'graph.facebook.com')
        return Response.json({
          platform: 'ig',
          field_data: [
            { name: 'full_name', values: ['Meta test lead'] },
            { name: 'phone_number', values: ['+12025550155'] },
          ],
        })
      }
      try {
        await processEvent(String(events[0]._id))
        await processEvent(String(events[0]._id))
      } finally {
        globalThis.fetch = originalFetch
      }
      const importedLead = await Lead.findOne({ workspaceId: first.workspace, externalId: '700' })
      assert.equal(importedLead?.source, 'Instagram')
      assert.equal(importedLead?.consent, 'unknown')
      const inbound = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '600' },
                  messages: [
                    {
                      id: 'wamid.synthetic',
                      from: '12025550155',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }
      assert.equal((await webhook('whatsapp', inbound)).status, 200)
      assert.equal((await webhook('whatsapp', inbound)).status, 200)
      const receipt = await WebhookEvent.findOne({
        workspaceId: first.workspace,
        provider: 'whatsapp',
      })
      assert.ok(receipt)
      await processEvent(String(receipt._id))
      const inbox = await request('/conversations', first)
      const [conversation] = await inbox.json()
      assert.equal(conversation.unread, 1)
      assert.equal(conversation.lastMessage, 'Hello')
      assert.equal(
        await Message.countDocuments({ workspaceId: first.workspace, direction: 'inbound' }),
        1,
      )
      const send = await request('/conversations/' + conversation._id + '/messages', {
        ...first,
        method: 'POST',
        body: { requestId: '2141159d-3902-46a8-9635-7245c5037781', text: 'Hello from Relay' },
      })
      assert.equal(send.status, 202)
      const sent = await send.json()
      assert.equal(sent.status, 'queued')
      let sends = 0
      globalThis.fetch = async (input, options) => {
        assert.ok(String(input).endsWith('/600/messages'))
        assert.equal(JSON.parse(String(options?.body)).biz_opaque_callback_data, sent._id)
        sends++
        return Response.json({ messages: [{ id: 'wamid.outbound-test' }] })
      }
      try {
        await deliver(sent._id)
        await deliver(sent._id)
      } finally {
        globalThis.fetch = originalFetch
      }
      assert.equal(sends, 1)
      assert.equal((await Message.findById(sent._id))?.status, 'sent')
      const update = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '600' },
                  statuses: [
                    {
                      id: 'wamid.outbound-test',
                      status: 'read',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                    },
                  ],
                },
              },
            ],
          },
        ],
      }
      assert.equal((await webhook('whatsapp', update)).status, 200)
      const statusEvent = await WebhookEvent.findOne({
        workspaceId: first.workspace,
        status: 'pending',
        provider: 'whatsapp',
      })
      assert.ok(statusEvent)
      await processEvent(String(statusEvent._id))
      assert.equal((await Message.findById(sent._id))?.status, 'read')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  },
)
