export const stages = ['New', 'Contacted', 'Interested', 'Follow-up', 'Converted', 'Lost'] as const
export type Stage = (typeof stages)[number]
export type Lead = {
  _id: string
  name: string
  phone?: string
  email?: string
  company?: string
  source: string
  campaign?: string
  campaignSheetId?: string
  campaignSheetName?: string
  sheetFields?: { label: string; value: string }[]
  status: Stage
  consent?: string
  assignedTo?: string
  tags?: string[]
  createdAt: string
  contactedAt?: string
  answers?: Record<string, unknown>
}
export type Task = {
  _id: string
  leadId: string
  description: string
  dueAt: string
  priority: string
  status: string
}
export type Activity = { _id: string; leadId: string; detail: string; createdAt: string }
export type Note = { _id: string; leadId: string; text: string; createdAt: string }
export type Chat = {
  _id: string
  leadId: string
  phone: string
  status: string
  unread: number
  lastMessage?: string
  lastInboundAt?: string
}
export type Message = {
  _id: string
  conversationId: string
  direction: string
  text: string
  status: string
  createdAt: string
  type?: string
  mediaId?: string
}
export type Template = {
  _id: string
  name: string
  language: string
  category: string
  body: string
  status: string
}
export type Automation = {
  _id: string
  name: string
  trigger: string
  action: string
  delay: number
  enabled: boolean
  templateId?: string
}
export type Metric = { _id: string | null; count: number }
export type Report = {
  stages: Metric[]
  sources: Metric[]
  dates: Metric[]
  campaigns?: Metric[]
  forms?: Metric[]
  team?: Metric[]
  messages: Metric[]
  response?: { average: number }[]
  recent: Lead[]
}
export type Demo = {
  leads: Lead[]
  tasks: Task[]
  activities: Activity[]
  notes: Note[]
  conversations: Chat[]
  messages: Message[]
  templates: Template[]
  automations: Automation[]
}
const date = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString()
export function sampleData(): Demo {
  const entries = [
    ['Riya Sharma', 'Orchard Realty', 'Facebook', 'Summer Open House', 'New'],
    ['Daniel Kim', 'Northline Studio', 'Instagram', 'Consultation', 'Interested'],
    ['Amara Okafor', 'Fieldwork Co.', 'Facebook', 'Summer Open House', 'Contacted'],
    ['Sofia Patel', 'West End Motors', 'Manual', 'Showroom Inquiry', 'Follow-up'],
    ['Noah Chen', 'Evergreen School', 'Facebook', 'Admissions 2027', 'Converted'],
    ['Elena Garcia', 'Meridian Homes', 'Instagram', 'Consultation', 'Lost'],
  ]
  const leads: Lead[] = Array.from({ length: 26 }, (_, i) => {
    const [name, company, source, campaign, status] = entries[i % entries.length]
    return {
      _id: 'demo-' + i,
      name:
        i < 6
          ? name
          : name.split(' ')[0] +
            ' ' +
            ['Wilson', 'Morgan', 'Davis', 'Singh', 'Ali'][Math.floor(i / 6)],
      company,
      source,
      campaign,
      status: status as Stage,
      phone: '+1202555' + String(100 + i).padStart(4, '0'),
      createdAt: date(-Math.floor(i * 0.6)),
      consent: i === 0 ? 'granted' : 'unknown',
    }
  })
  return {
    leads,
    tasks: [
      {
        _id: 'task-1',
        leadId: 'demo-3',
        description: 'Confirm showroom appointment',
        dueAt: date(0.12),
        priority: 'high',
        status: 'pending',
      },
      {
        _id: 'task-2',
        leadId: 'demo-1',
        description: 'Send the project brochure',
        dueAt: date(1.1),
        priority: 'normal',
        status: 'pending',
      },
    ],
    notes: [],
    activities: [
      {
        _id: 'activity-1',
        leadId: 'demo-0',
        detail: 'Lead captured from Facebook Lead Ads',
        createdAt: date(0),
      },
    ],
    conversations: [
      {
        _id: 'chat-1',
        leadId: 'demo-0',
        phone: leads[0].phone!,
        status: 'open',
        unread: 1,
        lastMessage: 'Is there a slot available on Saturday?',
        lastInboundAt: date(0),
      },
    ],
    messages: [
      {
        _id: 'm1',
        conversationId: 'chat-1',
        direction: 'inbound',
        text: 'Hi! Is there a slot available on Saturday?',
        status: 'received',
        createdAt: date(0),
      },
    ],
    templates: [
      {
        _id: 't1',
        name: 'welcome_inquiry',
        category: 'UTILITY',
        language: 'en_US',
        body: 'Hi {{1}}, thanks for reaching out. How can we help?',
        status: 'approved',
      },
    ],
    automations: [],
  }
}
export function reportFrom(data: Demo, from?: string, to?: string): Report {
  const inRange = (value: string) => (!from || value >= from) && (!to || value <= to)
  const leads = data.leads.filter((row) => inRange(row.createdAt))
  function group<T>(rows: T[], read: (row: T) => string) {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = read(row)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts].map(([_id, count]) => ({ _id, count }))
  }
  return {
    stages: group(leads, (row) => row.status),
    sources: group(leads, (row) => row.source),
    campaigns: group(leads, (row) => row.campaign || 'Unspecified'),
    dates: group(leads, (row) => row.createdAt.slice(0, 10)).sort((a, b) =>
      a._id.localeCompare(b._id),
    ),
    recent: leads.slice(0, 6),
    messages: group(
      data.messages.filter((row) => row.direction === 'outbound' && inRange(row.createdAt)),
      (row) => row.status,
    ),
  }
}
