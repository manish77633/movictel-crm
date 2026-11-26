'use client'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { api } from '../lib/api'
import {
  sampleData,
  type Demo,
  type Lead,
  type Task,
  type Chat,
  type Template,
  type Automation,
  type Message,
  type Note,
  type Activity,
} from '../lib/demo'
export type Account = {
  canAdministerSheets: boolean
  user: { _id: string; name: string; email: string }
  rows: { _id: string; name: string; role: string; timezone: string }[]
}
export type Member = { _id: string; userId: string; role: string; user?: Account['user'] }
export type LeadDetails = {
  row: Lead
  notes: Note[]
  activities: Activity[]
  followUps: Task[]
  conversation?: Chat
}
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const demoKey = 'relay-demo-v1'
function demoRequest(
  data: Demo,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Demo {
  const [, collection, id, operation] = path.split('/')
  const createdAt = now()
  const activity = (leadId: string, detail: string) => [
    { _id: uid(), leadId, detail, createdAt },
    ...data.activities,
  ]
  if (collection === 'leads') {
    if (id === 'bulk-assign') {
      const ids = body.ids as string[]
      return {
        ...data,
        leads: data.leads.map((row) =>
          ids.includes(row._id) ? { ...row, assignedTo: String(body.userId) } : row,
        ),
      }
    }
    if (!id) {
      const row = { ...body, _id: uid(), source: 'Manual', createdAt } as Lead
      return { ...data, leads: [row, ...data.leads], activities: activity(row._id, 'Lead created') }
    }
    if (operation === 'notes')
      return {
        ...data,
        notes: [{ _id: uid(), leadId: id, createdAt, text: String(body.text) }, ...data.notes],
        activities: activity(id, 'Note added'),
      }
    return {
      ...data,
      leads:
        method === 'DELETE'
          ? data.leads.filter((row) => row._id !== id)
          : data.leads.map((row) =>
              row._id === id
                ? {
                    ...row,
                    ...(operation === 'assign' ? { assignedTo: String(body.userId) } : body),
                  }
                : row,
            ),
      activities: activity(
        id,
        method === 'DELETE'
          ? 'Lead archived'
          : body.status
            ? 'Moved to ' + body.status
            : 'Lead updated',
      ),
    }
  }
  if (collection === 'followups')
    return {
      ...data,
      tasks: id
        ? data.tasks.map((row) =>
            row._id === id
              ? { ...row, ...body, ...(method === 'DELETE' && { status: 'cancelled' }) }
              : row,
          )
        : [{ ...body, _id: uid(), status: 'pending' } as Task, ...data.tasks],
    }
  if (collection === 'conversations') {
    if (!id) {
      const lead = data.leads.find((item) => item._id === body.leadId)
      if (!lead?.phone) throw new Error('Add a valid international phone number first.')
      if (data.conversations.some((item) => item.leadId === lead._id)) return data
      return {
        ...data,
        conversations: [
          { _id: uid(), leadId: lead._id, phone: lead.phone, status: 'open', unread: 0 },
          ...data.conversations,
        ],
      }
    }
    const chat = data.conversations.find((row) => row._id === id)
    if (operation === 'messages' && chat) {
      const lead = data.leads.find((row) => row._id === chat.leadId)
      if (lead?.consent === 'opted_out') throw new Error('This customer has opted out.')
      const template = data.templates.find((item) => item._id === body.templateId)
      if (body.templateId && (template?.status !== 'approved' || lead?.consent !== 'granted'))
        throw new Error('An approved template and recorded consent are required.')
      if (
        !template &&
        (!chat.lastInboundAt || Date.now() - Date.parse(chat.lastInboundAt) >= 86400000)
      )
        throw new Error('Use an approved template outside the 24-hour reply window.')
      const text = template
        ? template.body.replace(
            /\{\{(\d+)\}\}/g,
            (_match, index) => ((body.variables as string[]) || [])[Number(index) - 1] || '',
          )
        : String(body.text)
      return {
        ...data,
        messages: [
          ...data.messages,
          {
            _id: uid(),
            conversationId: id,
            direction: 'outbound',
            text,
            status: 'simulated',
            createdAt,
          },
        ],
        conversations: data.conversations.map((row) =>
          row._id === id ? { ...row, lastMessage: text } : row,
        ),
      }
    }
    return {
      ...data,
      conversations: data.conversations.map((row) => (row._id === id ? { ...row, ...body } : row)),
    }
  }
  if (collection === 'templates')
    return {
      ...data,
      templates: id
        ? data.templates.map((row) => (row._id === id ? { ...row, ...body } : row))
        : [{ ...body, _id: uid(), status: 'draft' } as Template, ...data.templates],
    }
  if (collection === 'automations')
    return {
      ...data,
      automations:
        method === 'DELETE'
          ? data.automations.filter((row) => row._id !== id)
          : id
            ? data.automations.map((row) => (row._id === id ? { ...row, ...body } : row))
            : [{ ...body, _id: uid() } as Automation, ...data.automations],
    }
  throw new Error('This action requires a connected workspace.')
}
export function useWorkspace(demo: boolean) {
  const client = useQueryClient()
  const [data, setData] = useState<Demo>(() => sampleData())
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState('')
  const account = useQuery({
    queryKey: ['account'],
    queryFn: () => api<Account>('/workspaces'),
    enabled: !demo,
    retry: false,
  })
  const workspace = account.data?.rows.find((row) => row._id === selected) || account.data?.rows[0]
  useEffect(() => {
    try {
      const saved = localStorage.getItem(demoKey)
      if (saved) setData(JSON.parse(saved))
    } catch {}
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (demo && loaded) localStorage.setItem(demoKey, JSON.stringify(data))
  }, [demo, loaded, data])
  const scope = workspace?._id
  useEffect(() => {
    if (demo || !scope) return
    const socket = io({ auth: { workspaceId: scope }, transports: ['polling'] })
    socket.on(
      'workspace.changed',
      () => void client.invalidateQueries({ queryKey: ['workspace', scope] }),
    )
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible')
        void client.invalidateQueries({
          queryKey: ['workspace', scope],
          predicate: ({ queryKey }) =>
            /^\/(leads|analytics|dashboard|campaign-sheets|integrations\/google-sheets)(\/|\?|$)/.test(
              String(queryKey[2]),
            ),
        })
    }, 30_000)
    socket.on('connect', () => void client.invalidateQueries({ queryKey: ['workspace', scope] }))
    return () => {
      window.clearInterval(refresh)
      socket.disconnect()
    }
  }, [demo, scope, client])
  async function refreshWorkspace() {
    await client.invalidateQueries({ queryKey: ['workspace', scope] })
  }
  async function createWorkspace(name: string) {
    const created = await api<{ _id: string }>('/workspaces', undefined, 'POST', { name })
    await client.invalidateQueries({ queryKey: ['account'] })
    setSelected(created._id)
  }
  async function mutate(path: string, method: string, body: Record<string, unknown> = {}) {
    if (demo) {
      setData(demoRequest(data, path, method, body))
      return
    }
    await api(path, scope, method, body)
    await refreshWorkspace()
    if (path.startsWith('/workspaces')) await client.invalidateQueries({ queryKey: ['account'] })
  }
  return {
    data,
    account,
    workspace,
    scope,
    selected,
    setSelected,
    mutate,
    createWorkspace,
    refreshWorkspace,
  }
}
export function useApi<T>(scope: string | undefined, path: string, enabled = true) {
  return useQuery({
    queryKey: ['workspace', scope, path],
    queryFn: () => api<T>(path, scope),
    enabled: Boolean(scope) && enabled,
    retry: false,
  })
}
