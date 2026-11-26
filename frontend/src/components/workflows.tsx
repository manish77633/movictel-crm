'use client'
import Script from 'next/script'
import { useEffect, useState } from 'react'
import { Facebook, MessageCircle, Send, Zap } from 'lucide-react'
import { api } from '../lib/api'
import {
  type Automation,
  type Chat,
  type Demo,
  type Lead,
  type Message,
  type Template,
} from '../lib/demo'
import { Avatar, Status, shortDate } from './dashboard'
import { ActionForm, Dialog, Empty } from './crm-forms'
import { GoogleSheets } from './google-sheets'
import { useQueryClient } from '@tanstack/react-query'
import { useApi, type LeadDetails } from './workspace-data'

type Change = (
  path: string,
  method: string,
  body?: Record<string, unknown>,
  message?: string,
) => Promise<void>
type Props = { demo: boolean; scope?: string; data: Demo; change: Change }
type ManagerProps = Props & { canManage: boolean }
type Integration = {
  _id: string
  provider: string
  label: string
  lastSyncAt?: string
  expiresAt?: string
}
type Config = {
  rows: Integration[]
  googleSheetsAdmin: boolean
  facebookReady: boolean
  whatsappAppId: string
  whatsappConfigId: string
  graphVersion: string
  testNumberEnabled: boolean
  mediaEnabled: boolean
}
type Form = { id: string; name: string; selected: boolean }
interface MetaSdk {
  init(input: Record<string, unknown>): void
  login(
    callback: (result: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>,
  ): void
}
declare global {
  interface Window {
    FB?: MetaSdk
  }
}
function launchSignup(config: Config) {
  return new Promise<{ code: string; accountId: string; phoneId: string }>((resolve, reject) => {
    let code = '',
      accountId = '',
      phoneId = ''
    const finish = () => {
      if (code && accountId && phoneId) {
        cleanup()
        resolve({ code, accountId, phoneId })
      }
    }
    const fail = (message: string) => {
      cleanup()
      reject(new Error(message))
    }
    function receive(event: MessageEvent) {
      if (
        ![
          'https://www.facebook.com',
          'https://web.facebook.com',
          'https://business.facebook.com',
        ].includes(event.origin)
      )
        return
      try {
        const result = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (result?.type !== 'WA_EMBEDDED_SIGNUP') return
        if (result.event === 'CANCEL' || result.event === 'ERROR') {
          fail('WhatsApp signup closed before completion.')
          return
        }
        if (
          typeof result.data?.waba_id === 'string' &&
          typeof result.data?.phone_number_id === 'string'
        ) {
          accountId = result.data.waba_id
          phoneId = result.data.phone_number_id
          finish()
        }
      } catch {}
    }
    const timer = setTimeout(() => fail('WhatsApp signup timed out.'), 300000)
    function cleanup() {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
    }
    window.addEventListener('message', receive)
    function login() {
      if (!window.FB) {
        fail('Meta sign-in could not load.')
        return
      }
      window.FB.init({ appId: config.whatsappAppId, version: config.graphVersion, xfbml: false })
      window.FB.login(
        (result) => {
          if (!result.authResponse?.code) {
            fail('WhatsApp authorization was not granted.')
            return
          }
          code = result.authResponse.code
          finish()
        },
        {
          config_id: config.whatsappConfigId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {} },
        },
      )
    }
    login()
  })
}
export function Integrations({
  demo,
  scope,
  canManage,
  change,
  simulate,
}: {
  demo: boolean
  scope?: string
  canManage: boolean
  change: Change
  simulate: () => void
}) {
  const queryClient = useQueryClient()
  const configQuery = useApi<Config>(scope, '/integrations')
  const config = configQuery.data
  const logs = useApi<{ _id: string; provider: string; status: string; createdAt: string }[]>(
    scope,
    '/integrations/logs',
    canManage,
  )
  const facebook = config?.rows.find((row) => row.provider === 'facebook'),
    whatsapp = config?.rows.find((row) => row.provider === 'whatsapp')
  const pages = useApi<{ externalId: string; name: string }[]>(
    scope,
    '/integrations/facebook/pages',
    !!facebook && canManage,
  )
  const [pageId, setPageId] = useState('')
  const forms = useApi<Form[]>(
    scope,
    '/integrations/facebook/forms?pageId=' + pageId,
    !!pageId && !!facebook && canManage,
  )
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [signup, setSignup] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)
  useEffect(() => {
    setChosen(forms.data?.filter((form) => form.selected).map((form) => form.id) || [])
  }, [forms.data])
  useEffect(() => {
    setPageId('')
    setSignup(false)
  }, [scope])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const label = (row?: Integration) =>
    demo
      ? 'Demo mode'
      : row
        ? row.expiresAt && Date.parse(row.expiresAt) < Date.now()
          ? 'Authorization expired'
          : 'Connected'
        : 'Disconnected'
  return (
    <>
      {!demo && canManage && config?.whatsappConfigId && (
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          onReady={() => setSdkReady(true)}
          onError={() => setError('Meta sign-in could not load.')}
        />
      )}
      <div className="page-title">
        <div>
          <h1>Integrations</h1>
          <p>Connect your lead sources and messaging account.</p>
        </div>
      </div>
      {(error || configQuery.isError) && (
        <p className="error" role="alert">
          {error || configQuery.error?.message}
        </p>
      )}
      {!demo && configQuery.isLoading && <Empty>Checking integration status…</Empty>}
      <div className="integration-grid">
        {!demo && scope && config?.googleSheetsAdmin && (
          <GoogleSheets
            key={scope}
            scope={scope}
            refresh={() => queryClient.invalidateQueries({ queryKey: ['workspace', scope] })}
          />
        )}
        <section className="surface panel">
          <div className="integration-heading">
            <span className="integration-icon">
              <Facebook size={23} />
            </span>
            <div>
              <h2>Facebook Lead Ads</h2>
              <p>Facebook and Instagram Instant Forms</p>
            </div>
          </div>
          <Status value={label(facebook)} />
          {demo ? (
            <>
              <p>Capture a sample submission without connecting Meta.</p>
              <button className="button primary" onClick={simulate}>
                Simulate incoming lead
              </button>
            </>
          ) : (
            <>
              <p>{facebook?.label || 'Connect an authorized Page to select lead forms.'}</p>
              {facebook?.lastSyncAt && <p>Last synced {shortDate(facebook.lastSyncAt)}</p>}
              {canManage && (
                <>
                  <div className="toolbar">
                    <button
                      disabled={busy || !config?.facebookReady}
                      className="button primary"
                      onClick={() =>
                        void run(async () => {
                          const result = await api<{ url: string }>(
                            '/integrations/facebook/connect',
                            scope,
                            'POST',
                            {},
                          )
                          window.location.assign(result.url)
                        })
                      }
                    >
                      {facebook ? 'Reconnect' : 'Connect Facebook'}
                    </button>
                    {facebook && (
                      <button
                        disabled={busy}
                        className="button"
                        onClick={() => {
                          if (confirm('Disconnect Facebook Lead Ads?'))
                            void run(() =>
                              change(
                                '/integrations/facebook/disconnect',
                                'POST',
                                {},
                                'Facebook disconnected',
                              ),
                            )
                        }}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                  {config && !config.facebookReady && (
                    <small>Ask your administrator to configure Meta Login for Business.</small>
                  )}
                  {facebook && (
                    <div className="form">
                      <label>
                        Facebook Page
                        <select value={pageId} onChange={(event) => setPageId(event.target.value)}>
                          <option value="">Select a Page</option>
                          {pages.data?.map((page) => (
                            <option key={page.externalId} value={page.externalId}>
                              {page.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(pages.isError || forms.isError) && (
                        <p className="error">{pages.error?.message || forms.error?.message}</p>
                      )}
                      {forms.data?.map((form) => (
                        <label className="checkbox" key={form.id}>
                          <input
                            type="checkbox"
                            checked={chosen.includes(form.id)}
                            onChange={(event) =>
                              setChosen(
                                event.target.checked
                                  ? [...chosen, form.id]
                                  : chosen.filter((id) => id !== form.id),
                              )
                            }
                          />
                          {form.name}
                        </label>
                      ))}
                      <div className="toolbar">
                        {forms.data && (
                          <button
                            disabled={busy}
                            className="button"
                            onClick={() =>
                              void run(() =>
                                change(
                                  '/integrations/facebook/forms',
                                  'POST',
                                  { pageId, formIds: chosen },
                                  'Lead forms saved',
                                ),
                              )
                            }
                          >
                            Save selected forms
                          </button>
                        )}
                        <button
                          disabled={busy}
                          className="button"
                          onClick={() =>
                            void run(() =>
                              change('/integrations/facebook/sync', 'POST', {}, 'Lead sync queued'),
                            )
                          }
                        >
                          Sync leads
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <section className="surface panel">
          <div className="integration-heading">
            <span className="integration-icon green">
              <MessageCircle size={23} />
            </span>
            <div>
              <h2>WhatsApp Business</h2>
              <p>Official WhatsApp Cloud API</p>
            </div>
          </div>
          <Status value={label(whatsapp)} />
          <p>
            {demo
              ? 'Try a simulated conversation in the Inbox.'
              : whatsapp?.label || 'Connect a business phone number for messaging.'}
          </p>
          {!demo && canManage && (
            <>
              <div className="toolbar">
                <button
                  className="button whatsapp"
                  disabled={busy || !config?.whatsappConfigId || !sdkReady}
                  onClick={() => setSignup(true)}
                >
                  {whatsapp ? 'Reconnect' : 'Connect WhatsApp'}
                </button>
                {config?.testNumberEnabled && (
                  <button
                    disabled={busy}
                    className="button"
                    onClick={() =>
                      void run(() =>
                        change(
                          '/integrations/whatsapp/connect',
                          'POST',
                          { test: true },
                          'Meta test number connected',
                        ),
                      )
                    }
                  >
                    Connect Meta test number
                  </button>
                )}
                {whatsapp && (
                  <button
                    disabled={busy}
                    className="button"
                    onClick={() => {
                      if (confirm('Disconnect this WhatsApp account?'))
                        void run(() =>
                          change(
                            '/integrations/whatsapp/disconnect',
                            'POST',
                            {},
                            'WhatsApp disconnected',
                          ),
                        )
                    }}
                  >
                    Disconnect
                  </button>
                )}
              </div>
              {config && !config.whatsappConfigId && (
                <small>Ask your administrator to configure WhatsApp Embedded Signup.</small>
              )}
            </>
          )}
        </section>
      </div>
      {!demo && canManage && (
        <section className="surface overview-bottom">
          <header>
            <h2>Integration events</h2>
          </header>
          {logs.data?.length ? (
            <ul className="row-list">
              {logs.data.map((event) => (
                <li key={event._id}>
                  <div>
                    {event.provider}
                    <small>{shortDate(event.createdAt)}</small>
                  </div>
                  <Status value={event.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{logs.error?.message || 'No integration events yet.'}</Empty>
          )}
        </section>
      )}
      {signup && config && (
        <Dialog title="Connect WhatsApp Business" onClose={() => setSignup(false)}>
          <ActionForm
            label="Continue to Meta"
            onSave={async (input) => {
              const authorization = await launchSignup(config)
              await change(
                '/integrations/whatsapp/connect',
                'POST',
                { ...authorization, ...(input.pin && { pin: input.pin }) },
                'WhatsApp account connected',
              )
              setSignup(false)
            }}
          >
            <label>
              Six-digit registration PIN, if required
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
              />
            </label>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}
export function Inbox({
  demo,
  scope,
  data,
  selected,
  select,
  change,
  openLead,
}: Props & { selected: string; select: (value: string) => void; openLead: (id: string) => void }) {
  const [filter, setFilter] = useState('All')
  const [messageType, setMessageType] = useState('text')
  const [templateId, setTemplateId] = useState('')
  const [error, setError] = useState('')
  const chats = useApi<(Chat & { lead?: Lead })[]>(
    scope,
    '/conversations?filter=' + encodeURIComponent(filter),
  )
  const mediaEnabled = useApi<Config>(scope, '/integrations', !demo).data?.mediaEnabled
  const demoRows = data.conversations.map((chat) => ({
    ...chat,
    lead: data.leads.find((row) => row._id === chat.leadId),
  }))
  const rows = demo
    ? demoRows.filter(
        (chat) =>
          filter === 'All' ||
          (filter === 'Unread' && chat.unread > 0) ||
          (filter === 'Open' && chat.status === 'open') ||
          (filter === 'Resolved' && chat.status === 'resolved') ||
          (filter === 'Assigned to me' && chat.lead?.assignedTo === 'demo-owner'),
      )
    : chats.data || []
  const current = rows.find((chat) => chat._id === selected)
  const history = useApi<Message[]>(scope, '/conversations/' + selected + '/messages', !!current)
  const templates = useApi<Template[]>(scope, '/templates', !!current)
  const approved = (demo ? data.templates : templates.data || []).filter(
    (row) => row.status === 'approved',
  )
  const chosen = approved.find((row) => row._id === templateId)
  const vars = Array.from(
    new Set(Array.from(chosen?.body.matchAll(/\{\{(\d+)\}\}/g) || [], (match) => Number(match[1]))),
  ).sort((a, b) => a - b)
  const info = useApi<LeadDetails>(scope, '/leads/' + current?.leadId, !!current)
  const messages = demo
    ? data.messages.filter((row) => row.conversationId === selected)
    : history.data || []
  const title = current?.lead?.name || current?.phone || 'Customer'
  function updateChat(input: Record<string, unknown>) {
    setError('')
    void change('/conversations/' + selected, 'PATCH', input, '').catch((error) =>
      setError((error as Error).message),
    )
  }
  async function download(mediaId: string) {
    setError('')
    try {
      const result = await fetch('/api/v1/conversations/' + selected + '/media/' + mediaId, {
        headers: { 'x-workspace-id': scope || '' },
      })
      if (!result.ok) throw new Error('The attachment could not be downloaded.')
      const url = URL.createObjectURL(await result.blob())
      const link = document.createElement('a')
      link.href = url
      link.download =
        result.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ||
        'whatsapp-attachment'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setError((error as Error).message)
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Inbox</h1>
          <p>Manage your team’s WhatsApp conversations.</p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inbox surface">
        <aside className="conversation-list">
          <select
            aria-label="Conversation filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {['All', 'Unread', 'Assigned to me', 'Open', 'Resolved'].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          {chats.isError ? (
            <Empty>{chats.error.message}</Empty>
          ) : rows.length ? (
            rows.map((chat) => (
              <button
                className={'conversation ' + (chat._id === selected ? 'selected' : '')}
                key={chat._id}
                onClick={() => {
                  select(chat._id)
                  setTemplateId('')
                  setError('')
                }}
              >
                <Avatar name={chat.lead?.name || chat.phone} />
                <span>
                  <strong>{chat.lead?.name || chat.phone}</strong>
                  <small>{chat.lastMessage || 'Conversation opened'}</small>
                </span>
                {chat.unread > 0 && <b>{chat.unread}</b>}
              </button>
            ))
          ) : (
            <Empty>
              {chats.isLoading ? 'Loading conversations…' : 'No conversations match this view.'}
            </Empty>
          )}
        </aside>
        <section className="conversation-main">
          {current ? (
            <>
              <header>
                <div className="customer">
                  <Avatar name={title} />
                  <div>
                    <strong>{title}</strong>
                    <small>{current.phone}</small>
                  </div>
                </div>
                <div className="toolbar">
                  {current.unread > 0 && (
                    <button className="button" onClick={() => updateChat({ unread: 0 })}>
                      Mark read
                    </button>
                  )}
                  <button
                    className="button"
                    onClick={() =>
                      updateChat({ status: current.status === 'open' ? 'resolved' : 'open' })
                    }
                  >
                    {current.status === 'open' ? 'Resolve' : 'Reopen'}
                  </button>
                </div>
              </header>
              <div className="message-history">
                {history.isError ? (
                  <Empty>{history.error.message}</Empty>
                ) : (
                  messages.map((message) => (
                    <div className={'message ' + message.direction} key={message._id}>
                      <p>{message.text || message.type}</p>
                      {message.mediaId && !demo && (
                        <button
                          className="text-button"
                          onClick={() => void download(message.mediaId!)}
                        >
                          Download {message.type}
                        </button>
                      )}
                      <small>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        · {message.status}
                      </small>
                    </div>
                  ))
                )}
              </div>
              <ActionForm
                key={selected}
                label="Send message"
                onSave={async (input) => {
                  const body =
                    messageType === 'template'
                      ? { templateId, variables: vars.map((index) => input['variable-' + index]) }
                      : messageType === 'text'
                        ? { text: input.text }
                        : {
                            mediaType: messageType,
                            mediaUrl: input.mediaUrl,
                            ...(input.text && { text: input.text }),
                          }
                  await change(
                    '/conversations/' + selected + '/messages',
                    'POST',
                    { ...body, requestId: crypto.randomUUID() },
                    demo ? 'Simulated message added' : 'Message queued',
                  )
                }}
              >
                <label>
                  Message type
                  <select
                    value={messageType}
                    onChange={(event) => setMessageType(event.target.value)}
                  >
                    <option value="text">Text reply</option>
                    <option value="template">Approved template</option>
                    {mediaEnabled && (
                      <>
                        <option value="image">Image link</option>
                        <option value="document">Document link</option>
                      </>
                    )}
                  </select>
                </label>
                {messageType === 'text' ? (
                  <label>
                    Message
                    <textarea
                      key={messages.length}
                      name="text"
                      maxLength={4096}
                      required
                      placeholder="Write a reply…"
                    />
                  </label>
                ) : messageType === 'template' ? (
                  <>
                    <label>
                      Template
                      <select
                        required
                        value={templateId}
                        onChange={(event) => setTemplateId(event.target.value)}
                      >
                        <option value="">Choose approved template</option>
                        {approved.map((template) => (
                          <option key={template._id} value={template._id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {chosen && <p className="template-preview">{chosen.body}</p>}
                    {vars.map((index) => (
                      <label key={index}>
                        Variable {index}
                        <input name={'variable-' + index} required />
                      </label>
                    ))}
                  </>
                ) : (
                  <>
                    <label>
                      Attachment URL
                      <input type="url" name="mediaUrl" required />
                    </label>
                    <label>
                      Caption
                      <input name="text" maxLength={1024} />
                    </label>
                  </>
                )}
              </ActionForm>
            </>
          ) : (
            <Empty>Select a conversation to view messages.</Empty>
          )}
        </section>
        <aside className="conversation-info">
          {current && (
            <>
              <h2>Customer details</h2>
              <Avatar name={title} />
              <h3>{title}</h3>
              <p>{current.phone}</p>
              {current.lead && (
                <>
                  <Status value={current.lead.status} />
                  <p>
                    {current.lead.source} {current.lead.campaign}
                  </p>
                  {current.lead.email && <p>{current.lead.email}</p>}
                  {(demo
                    ? data.notes.filter((note) => note.leadId === current.leadId)
                    : info.data?.notes || []
                  )
                    .slice(0, 3)
                    .map((note) => (
                      <p key={note._id}>{note.text}</p>
                    ))}
                  <button className="button" onClick={() => openLead(current.leadId)}>
                    Open lead
                  </button>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  )
}
export function Templates({ demo, scope, data, canManage, change }: ManagerProps) {
  const query = useApi<Template[]>(scope, '/templates')
  const rows = demo ? data.templates : query.data || []
  const [editing, setEditing] = useState<Template | null | undefined>()
  const [banner, setBanner] = useState('')
  const [preview, setPreview] = useState<Template>()
  const [submission, setSubmission] = useState<Template>()
  const connected = useApi<Config>(scope, '/integrations').data?.rows.some(
    (row) => row.provider === 'whatsapp',
  )
  function run(action: () => Promise<void>) {
    setBanner('')
    void action().catch((error) => setBanner((error as Error).message))
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Templates</h1>
          <p>Manage reusable WhatsApp messages.</p>
        </div>
        {canManage && (
          <div className="toolbar">
            {connected && (
              <button
                className="button"
                onClick={() =>
                  run(() => change('/templates/sync', 'POST', {}, 'Templates synchronized'))
                }
              >
                Sync templates
              </button>
            )}
            <button className="button primary" onClick={() => setEditing(null)}>
              New draft
            </button>
          </div>
        )}
      </div>
      <section className="surface">
        {(banner || query.isError) && <Empty>{banner || query.error?.message}</Empty>}
        {rows.length ? (
          <ul className="row-list">
            {rows.map((row) => (
              <li key={row._id}>
                <div>
                  <button className="text-button" onClick={() => setPreview(row)}>
                    {row.name}
                  </button>
                  <small>
                    {row.category} · {row.language}
                  </small>
                </div>
                <div className="toolbar">
                  <Status value={row.status} />
                  {canManage && row.status === 'draft' && (
                    <>
                      <button className="button" onClick={() => setEditing(row)}>
                        Edit
                      </button>
                      {connected && (
                        <button className="button" onClick={() => setSubmission(row)}>
                          Submit to Meta
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{query.isLoading ? 'Loading templates…' : 'No templates yet.'}</Empty>
        )}
      </section>
      {editing !== undefined && (
        <Dialog
          title={editing ? 'Edit draft' : 'New template draft'}
          onClose={() => setEditing(undefined)}
        >
          <ActionForm
            onSave={async (input) => {
              await change(
                '/templates' + (editing ? '/' + editing._id : ''),
                editing ? 'PATCH' : 'POST',
                input,
                'Draft saved',
              )
              setEditing(undefined)
            }}
          >
            <label>
              Template name
              <input
                required
                name="name"
                pattern="[a-z][a-z0-9_]{0,127}"
                defaultValue={editing?.name}
                placeholder="welcome_inquiry"
              />
            </label>
            <div className="form-grid">
              <label>
                Category
                <select name="category" defaultValue={editing?.category || 'UTILITY'}>
                  <option>UTILITY</option>
                  <option>MARKETING</option>
                </select>
              </label>
              <label>
                Language
                <input name="language" required defaultValue={editing?.language || 'en_US'} />
              </label>
            </div>
            <label>
              Message body
              <textarea
                required
                maxLength={1024}
                name="body"
                defaultValue={editing?.body}
                placeholder={'Hi {{1}}, how can we help?'}
              />
            </label>
          </ActionForm>
        </Dialog>
      )}
      {preview && (
        <Dialog title={preview.name} onClose={() => setPreview(undefined)}>
          <p className="template-preview">{preview.body}</p>
          <Status value={preview.status} />
        </Dialog>
      )}
      {submission && (
        <Dialog title="Submit template for review" onClose={() => setSubmission(undefined)}>
          <ActionForm
            label="Submit to Meta"
            onSave={async (input) => {
              await change(
                '/templates/' + submission._id + '/submit',
                'POST',
                { examples: Object.values(input) },
                'Template submitted',
              )
              setSubmission(undefined)
            }}
          >
            <p className="template-preview">{submission.body}</p>
            {[
              ...new Set(
                [...submission.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])),
              ),
            ]
              .sort((a, b) => a - b)
              .map((index) => (
                <label key={index}>
                  Example for variable {index}
                  <input name={'example-' + index} required maxLength={256} />
                </label>
              ))}
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}
export function Automations({ demo, scope, data, canManage, change }: ManagerProps) {
  const query = useApi<Automation[]>(scope, '/automations')
  const templatesQuery = useApi<Template[]>(scope, '/templates')
  const members = useApi<{ userId: string; user?: { name: string } }[]>(scope, '/team')
  const rows = demo ? data.automations : query.data || []
  const templates = (demo ? data.templates : templatesQuery.data || []).filter(
    (row) => row.status === 'approved',
  )
  const [creating, setCreating] = useState(false)
  const [action, setAction] = useState('template')
  const [logId, setLogId] = useState('')
  const [banner, setBanner] = useState('')
  const logs = useApi<{ _id: string; status: string; dueAt: string }[]>(
    scope,
    '/automations/' + logId + '/executions',
    !!logId,
  )
  function run(action: () => Promise<void>) {
    setBanner('')
    void action().catch((error) => setBanner((error as Error).message))
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Automations</h1>
          <p>Run actions when leads or follow-ups change.</p>
        </div>
        {canManage && (
          <button
            className="button primary"
            onClick={() => {
              setAction('template')
              setCreating(true)
            }}
          >
            <Zap size={16} /> New rule
          </button>
        )}
      </div>
      {(banner || query.isError) && (
        <p className="error" role="alert">
          {banner || query.error?.message}
        </p>
      )}
      <section className="surface">
        {rows.length ? (
          <ul className="row-list">
            {rows.map((row) => (
              <li key={row._id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {row.trigger.replaceAll('.', ' ')} → {row.action} · {row.delay} min
                  </small>
                </div>
                <div className="toolbar">
                  <Status value={row.enabled ? 'enabled' : 'paused'} />
                  {!demo && (
                    <button className="button" onClick={() => setLogId(row._id)}>
                      Runs
                    </button>
                  )}
                  {canManage && (
                    <>
                      <button
                        className="button"
                        onClick={() =>
                          run(() =>
                            change(
                              '/automations/' + row._id,
                              'PATCH',
                              { enabled: !row.enabled },
                              row.enabled ? 'Rule paused' : 'Rule enabled',
                            ),
                          )
                        }
                      >
                        {row.enabled ? 'Pause' : 'Enable'}
                      </button>
                      <button
                        className="button"
                        onClick={() => {
                          if (confirm('Delete this automation?'))
                            run(() =>
                              change('/automations/' + row._id, 'DELETE', {}, 'Rule deleted'),
                            )
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{query.isLoading ? 'Loading rules…' : 'No automation rules yet.'}</Empty>
        )}
      </section>
      {creating && (
        <Dialog title="New automation rule" onClose={() => setCreating(false)}>
          <ActionForm
            label="Create rule"
            onSave={async (input) => {
              await change(
                '/automations',
                'POST',
                {
                  name: input.name,
                  trigger: input.trigger,
                  action,
                  delay: Number(input.delay),
                  enabled: input.enabled === 'on',
                  ...(input.formId && { formId: input.formId }),
                  ...(input.templateId && {
                    templateId: input.templateId,
                    templateVariables: input.variables
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  }),
                  ...(input.assignedTo && { assignedTo: input.assignedTo }),
                },
                'Rule created',
              )
              setCreating(false)
            }}
          >
            <label>
              Rule name
              <input name="name" required />
            </label>
            <div className="form-grid">
              <label>
                Trigger
                <select name="trigger">
                  <option value="lead.imported">New Facebook lead</option>
                  <option value="lead.status">Lead status changed</option>
                  <option value="followup.created">Follow-up scheduled</option>
                </select>
              </label>
              <label>
                Action
                <select value={action} onChange={(event) => setAction(event.target.value)}>
                  <option value="template">Send approved template</option>
                  <option value="assign">Assign lead</option>
                  <option value="followup">Create follow-up</option>
                  <option value="notification">Create notification</option>
                </select>
              </label>
            </div>
            <label>
              Facebook form ID, optional
              <input name="formId" inputMode="numeric" pattern="[0-9]+" />
            </label>
            {action === 'template' && (
              <>
                <label>
                  Approved template
                  <select name="templateId" required>
                    <option value="">Choose a template</option>
                    {templates.map((row) => (
                      <option value={row._id} key={row._id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Variables in order
                  <input name="variables" placeholder="name, company" />
                </label>
              </>
            )}
            {action === 'assign' && !demo && (
              <label>
                Assign to
                <select name="assignedTo">
                  <option value="">Round-robin</option>
                  {members.data?.map((member) => (
                    <option value={member.userId} key={member.userId}>
                      {member.user?.name || member.userId}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Delay in minutes
              <input name="delay" type="number" min="0" max="43200" defaultValue="0" required />
            </label>
            <label className="checkbox">
              <input name="enabled" type="checkbox" /> Enable this rule
            </label>
            {demo && (
              <small>
                Demo rules are saved locally. Only a connected workspace runs scheduled jobs.
              </small>
            )}
          </ActionForm>
        </Dialog>
      )}
      {logId && (
        <Dialog title="Automation runs" onClose={() => setLogId('')}>
          {logs.data?.length ? (
            <ul className="row-list">
              {logs.data.map((item) => (
                <li key={item._id}>
                  {shortDate(item.dueAt)} <Status value={item.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{logs.error?.message || 'No runs yet.'}</Empty>
          )}
        </Dialog>
      )}
    </>
  )
}
