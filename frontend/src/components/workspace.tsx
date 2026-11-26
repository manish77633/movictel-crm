'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AudioLines,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  ChartNoAxesCombined,
  ContactRound,
  LayoutDashboard,
  Columns3,
  LogOut,
  Menu,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  UsersRound,
} from 'lucide-react'
import { api } from '../lib/api'
import {
  stages,
  reportFrom,
  type Lead,
  type Stage,
  type Report,
  type Task,
  type Activity,
} from '../lib/demo'
import { Avatar, Dashboard, LeadTable, Status, shortDate } from './dashboard'
import { Pipeline } from './pipeline'
import { useApi, useWorkspace, type LeadDetails, type Member } from './workspace-data'
import { ActionForm, Dialog, Empty, FollowUpFields, LeadFields } from './crm-forms'
import { GoogleSheets } from './google-sheets'

const navigation = [
  ['Overview', LayoutDashboard],
  ['Leads', ContactRound],
  ['Pipeline', Columns3],
  ['Follow-ups', CalendarDays],
  ['Analytics', ChartNoAxesCombined],
  ['Admin panel', UsersRound],
  ['Settings', Settings],
] as const
type View = (typeof navigation)[number][0]
function saveLead(input: Record<string, string>) {
  const phone = input.phone.replace(/[\s().-]/g, '')
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error('Enter a phone number with its country code, for example +91 98765 43210.')
  }
  return {
    ...input,
    phone,
    tags: input.tags
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  }
}
function saveTask(input: Record<string, string>, leadId: string) {
  return { ...input, leadId, dueAt: new Date(input.dueAt).toISOString() }
}
type Notification = { _id: string; text: string; read: boolean }
export function Workspace() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000 } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading…</p>}>
        <WorkspaceContent />
      </Suspense>
    </QueryClientProvider>
  )
}
function WorkspaceContent() {
  const params = useSearchParams()
  const router = useRouter()
  const demo = params.get('demo') === '1'
  const requested = params.get('view')
  const [requestedView, setView] = useState<View | undefined>(
    () => navigation.find(([name]) => name === requested)?.[0],
  )
  const [drawer, setDrawer] = useState(false),
    [collapsed, setCollapsed] = useState(false)
  const [dialog, setDialog] = useState(''),
    [selectedLead, setSelectedLead] = useState('')
  const [toast, setToast] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('')
  const [status, setStatus] = useState(''),
    [source, setSource] = useState(''),
    [agent, setAgent] = useState(''),
    [sort, setSort] = useState('newest'),
    [page, setPage] = useState(1)
  const [selection, setSelection] = useState<string[]>([])
  const [range, setRange] = useState('30'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('')
  const [taskTab, setTaskTab] = useState('Upcoming')
  const [rescheduling, setRescheduling] = useState<Task>()
  const state = useWorkspace(demo)
  const { data, scope, workspace, account, mutate } = state
  const canManage = demo || workspace?.role === 'owner' || workspace?.role === 'admin'
  const crmAdmin = !!account.data?.canAdministerSheets
  const adminPanel = crmAdmin && canManage
  const view =
    requestedView === 'Admin panel' && !adminPanel
      ? 'Overview'
      : (requestedView ?? (adminPanel ? 'Admin panel' : 'Overview'))
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3800)
      return () => clearTimeout(timer)
    }
  }, [toast])
  useEffect(() => {
    document.title = view + ' | Relay'
  }, [view])
  useEffect(() => {
    setSelection([])
  }, [scope, view, status, source, agent, sort, page, query])
  const [referenceTime] = useState(() => Date.now())
  const dateStart =
    range === 'custom'
      ? from
        ? from + 'T00:00:00.000Z'
        : undefined
      : new Date(referenceTime - (Number(range) - 1) * 86400000).toISOString().slice(0, 10) +
        'T00:00:00.000Z'
  const dateEnd = range === 'custom' && to ? to + 'T23:59:59.999Z' : undefined
  const dateParams = new URLSearchParams({
    ...(dateStart && { from: dateStart }),
    ...(dateEnd && { to: dateEnd }),
  })
  const filters = new URLSearchParams({
    limit: view === 'Pipeline' ? '100' : '25',
    page: String(view === 'Pipeline' ? 1 : page),
    sort,
    ...(query && { q: query }),
    ...(status && view !== 'Pipeline' && { status }),
    ...(source && { source }),
    ...(agent && { assignedTo: agent }),
  })
  const leadQuery = useApi<{ rows: Lead[]; total: number }>(
    scope,
    '/leads?' + filters,
    ['Leads', 'Pipeline', 'Follow-ups'].includes(view),
  )
  const detailsQuery = useApi<LeadDetails>(scope, '/leads/' + selectedLead, !!selectedLead)
  const dashboard = useApi<Report>(
    scope,
    '/dashboard/' + (view === 'Analytics' ? 'analytics' : 'overview') + '?' + dateParams,
    ['Overview', 'Analytics'].includes(view),
  )
  const team = useApi<Member[]>(scope, '/team', true)
  const tasks = useApi<Task[]>(scope, '/followups', ['Overview', 'Follow-ups'].includes(view))
  const activities = useApi<Activity[]>(scope, '/dashboard/activities', view === 'Overview')
  const notifications = useApi<Notification[]>(scope, '/notifications')
  const row = demo ? data.leads.find((lead) => lead._id === selectedLead) : detailsQuery.data?.row
  const details =
    demo && row
      ? {
          row,
          notes: data.notes.filter((n) => n.leadId === row._id),
          activities: data.activities.filter((a) => a.leadId === row._id),
          followUps: data.tasks.filter((t) => t.leadId === row._id),
          conversation: data.conversations.find((c) => c.leadId === row._id),
        }
      : detailsQuery.data
  const members: Member[] = demo
    ? [
        {
          _id: 'demo-owner',
          userId: 'demo-owner',
          role: 'owner',
          user: { _id: 'demo-owner', name: 'Taylor Morgan', email: 'taylor@example.test' },
        },
        {
          _id: 'demo-agent',
          userId: 'demo-agent',
          role: 'agent',
          user: { _id: 'demo-agent', name: 'Casey Walker', email: 'casey@example.test' },
        },
      ]
    : team.data || []
  const demoLeads = data.leads
    .filter(
      (row) =>
        (!status || view === 'Pipeline' || row.status === status) &&
        (!source || row.source === source) &&
        (!agent || row.assignedTo === agent) &&
        (!query ||
          [row.name, row.phone, row.email].some((part) =>
            part?.toLowerCase().includes(query.toLowerCase()),
          )),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'oldest'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
    )
  const leads = demo
    ? view === 'Pipeline'
      ? demoLeads
      : demoLeads.slice((page - 1) * 25, page * 25)
    : leadQuery.data?.rows || []
  const total = demo ? demoLeads.length : leadQuery.data?.total || 0
  const followups = demo
    ? data.tasks.map((task) =>
        task.status === 'pending' && Date.parse(task.dueAt) < Date.now()
          ? { ...task, status: 'overdue' }
          : task,
      )
    : tasks.data || []
  const report = demo ? reportFrom(data, dateStart, dateEnd) : dashboard.data
  const user = demo ? 'Taylor Morgan' : account.data?.user?.name || 'Account'
  function go(next: View) {
    setView(next)
    setDrawer(false)
    setStatus('')
    setSource('')
    setAgent('')
    setPage(1)
    setSelectedLead('')
    setDialog('')
  }
  function open(id: string) {
    setSelectedLead(id)
    setDialog('details')
  }
  function close() {
    setDialog('')
    setSelectedLead('')
  }
  async function change(
    path: string,
    method: string,
    body: Record<string, unknown> = {},
    label = 'Changes saved',
  ) {
    await mutate(path, method, body)
    if (label) setToast(label)
  }
  function run(action: () => Promise<unknown>) {
    void action().catch((error) => setToast((error as Error).message))
  }
  async function exportLeads() {
    let blob: Blob
    if (demo) {
      const csv = (value: string) =>
        '"' + (/^[\s]*[=+@-]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"'
      blob = new Blob(
        [
          'Name,Phone,Source,Status\r\n' +
            demoLeads
              .map((r) => [r.name, r.phone || '', r.source, r.status].map(csv).join(','))
              .join('\r\n'),
        ],
        { type: 'text/csv' },
      )
    } else {
      const response = await fetch('/api/v1/leads/export?' + filters, {
        headers: { 'x-workspace-id': scope! },
      })
      if (!response.ok) throw new Error('Could not export leads. Try again.')
      blob = await response.blob()
    }
    const href = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = href
    link.download = 'leads.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }
  if (!demo && !scope)
    return (
      <main className="account">
        <Link href="/" className="brand">
          <AudioLines />
          Relay
        </Link>
        <section className="surface">
          <h1>
            {account.isPending
              ? 'Loading workspace…'
              : account.isError
                ? 'Sign in to your workspace'
                : crmAdmin
                  ? 'Admin panel'
                  : 'No workspace access'}
          </h1>
          {account.isError && (
            <>
              <p>{account.error.message}</p>
              <Link className="button primary" href="/account">
                Log in
              </Link>
            </>
          )}
          {crmAdmin && account.data && !account.data.rows.length && (
            <>
              <p>
                Create a workspace for your first sheet. Then connect the sheet and grant client
                access.
              </p>
              <ActionForm
                label="Create workspace"
                onSave={async (input) => {
                  await state.createWorkspace(input.name)
                  go('Admin panel')
                }}
              >
                <label>
                  Workspace name
                  <input name="name" required />
                </label>
              </ActionForm>
            </>
          )}
          {account.data && !crmAdmin && <p>Ask your CRM admin to grant workspace access.</p>}
          <Link className="text-button" href="/workspace?demo=1">
            Open the interactive demo
          </Link>
        </section>
      </main>
    )
  return (
    <div className={'app-shell ' + (collapsed ? 'collapsed ' : '') + (drawer ? 'drawer-open' : '')}>
      {drawer && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link href="/" className="brand">
            <AudioLines size={22} />
            <span>Relay</span>
          </Link>
          <button
            className="icon-button collapse"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <button
          className="workspace-switch"
          onClick={() => setDialog('workspaces')}
          title="Switch workspace"
        >
          <span className="workspace-symbol">
            {(demo ? 'O' : workspace?.name?.[0] || 'R').toUpperCase()}
          </span>
          <span>
            <strong>{demo ? 'Orchard Studio' : workspace?.name}</strong>
            <small>{demo ? 'Demo workspace' : workspace?.role}</small>
          </span>
          <ChevronsUpDown size={14} />
        </button>
        <nav aria-label="Workspace">
          {navigation
            .filter(([name]) => name !== 'Admin panel' || adminPanel)
            .map(([name, Icon]) => (
              <button
                key={name}
                className={view === name ? 'selected' : ''}
                aria-current={view === name ? 'page' : undefined}
                title={name}
                onClick={() => {
                  setSearch('')
                  go(name)
                }}
              >
                <Icon size={17} />
                <span>{name}</span>
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setDialog('help')} title="Help">
            <CircleHelp size={17} />
            <span>Help</span>
          </button>
          <button
            onClick={async () => {
              if (!demo) await api('/auth/logout', undefined, 'POST', {})
              router.push('/')
            }}
            title={demo ? 'Exit demo' : 'Log out'}
          >
            <LogOut size={17} />
            <span>{demo ? 'Exit demo' : 'Log out'}</span>
          </button>
          <div className="profile">
            <Avatar name={user} />
            <span>
              <strong>{user}</strong>
              <small>{demo ? 'Demo user' : workspace?.role}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="top-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
            >
              <Menu size={22} />
            </button>
            <span>{view}</span>
            {demo && <span className="demo-label">Demo · Simulated data</span>}
          </div>
          <div className="top-actions">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search leads"
                placeholder="Search leads…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  if (view !== 'Leads') go('Leads')
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setDialog('notifications')}
            >
              <Bell size={19} />
              {!!notifications.data?.some((n) => !n.read) && <i />}
            </button>
            <button
              className="icon-button quick-add"
              aria-label="Quick add lead"
              onClick={() => setDialog('add')}
            >
              <Plus size={20} />
            </button>
            <Avatar name={user} />
          </div>
        </header>
        <main className="app-content">
          {(view === 'Overview' || view === 'Analytics') && (
            <>
              <div className="date-row">
                <CalendarDays size={15} />
                <select
                  aria-label="Date range"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  <option value="1">Today</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
                {range === 'custom' && (
                  <>
                    <input
                      type="date"
                      aria-label="Start date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                    <input
                      type="date"
                      aria-label="End date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </>
                )}
              </div>
              {dashboard.isError ? (
                <ErrorLine
                  message={dashboard.error.message}
                  retry={() => void dashboard.refetch()}
                />
              ) : report ? (
                <Dashboard
                  report={report}
                  onOpen={open}
                  onAdd={() => setDialog('add')}
                  onLeads={() => go('Leads')}
                  extra={view === 'Analytics'}
                />
              ) : (
                <Empty>Loading workspace metrics…</Empty>
              )}
              {view === 'Overview' && (
                <div className="dashboard-grid overview-bottom">
                  <section className="surface">
                    <header>
                      <h2>Upcoming follow-ups</h2>
                      <button className="text-button" onClick={() => go('Follow-ups')}>
                        View all
                      </button>
                    </header>
                    <ul className="row-list">
                      {followups
                        .filter((row) => row.status === 'pending')
                        .slice(0, 4)
                        .map((row) => (
                          <li key={row._id}>
                            <button className="text-button" onClick={() => open(row.leadId)}>
                              {row.description}
                            </button>
                            {shortDate(row.dueAt)}
                          </li>
                        ))}
                    </ul>
                    {!followups.some((row) => row.status === 'pending') && (
                      <Empty>No upcoming follow-ups.</Empty>
                    )}
                  </section>
                  <section className="surface">
                    <header>
                      <h2>Recent activity</h2>
                      {adminPanel && (
                        <button className="text-button" onClick={() => go('Admin panel')}>
                          Admin panel
                        </button>
                      )}
                    </header>
                    <ul className="row-list">
                      {(demo ? data.activities : activities.data || []).slice(0, 4).map((row) => (
                        <li key={row._id}>
                          {row.detail}
                          <small>{shortDate(row.createdAt)}</small>
                        </li>
                      ))}
                    </ul>
                    {!(demo ? data.activities : activities.data)?.length && (
                      <Empty>Lead activity will appear here.</Empty>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
          {(view === 'Leads' || view === 'Pipeline') && (
            <>
              <div className="page-title">
                <div>
                  <h1>{view}</h1>
                  <p>
                    {view === 'Leads'
                      ? 'Search and manage your customer records.'
                      : 'Move leads through your sales stages.'}
                  </p>
                </div>
                <div className="toolbar">
                  {view === 'Leads' && (
                    <button className="button" onClick={() => run(exportLeads)}>
                      Export CSV
                    </button>
                  )}
                  <button className="button primary" onClick={() => setDialog('add')}>
                    <Plus size={16} /> Add lead
                  </button>
                </div>
              </div>
              <div className="toolbar filters">
                {view === 'Leads' && (
                  <select
                    aria-label="Status filter"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">All statuses</option>
                    {stages.map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="Source filter"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">All sources</option>
                  {['Google Sheets', 'Manual'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                {canManage && (
                  <select
                    aria-label="Assignee filter"
                    value={agent}
                    onChange={(e) => {
                      setAgent(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">All assignees</option>
                    {members.map((m) => (
                      <option value={m.userId} key={m._id}>
                        {m.user?.name || m.role}
                      </option>
                    ))}
                  </select>
                )}
                {view === 'Leads' && (
                  <select
                    aria-label="Sort leads"
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="name">Name</option>
                  </select>
                )}
              </div>
              {leadQuery.isError ? (
                <ErrorLine
                  message={leadQuery.error.message}
                  retry={() => void leadQuery.refetch()}
                />
              ) : !demo && leadQuery.isPending ? (
                <Empty>Loading leads…</Empty>
              ) : view === 'Pipeline' ? (
                <>
                  <Pipeline
                    rows={leads}
                    open={open}
                    move={(id, status) =>
                      run(() =>
                        change('/leads/' + id + '/status', 'PATCH', { status }, 'Lead moved'),
                      )
                    }
                  />
                  {total > leads.length && (
                    <p>
                      Showing {leads.length} of {total} leads. Use filters to narrow the board.
                    </p>
                  )}
                </>
              ) : (
                <section className="surface">
                  {canManage && selection.length > 0 && (
                    <header>
                      <span>{selection.length} selected</span>
                      <button className="button" onClick={() => setDialog('bulk-assign')}>
                        Assign selected
                      </button>
                    </header>
                  )}
                  <LeadTable
                    rows={leads}
                    onOpen={open}
                    selection={canManage ? selection : undefined}
                    onSelect={(id) =>
                      setSelection((current) =>
                        current.includes(id)
                          ? current.filter((item) => item !== id)
                          : [...current, id],
                      )
                    }
                    assignees={Object.fromEntries(
                      members.map((member) => [member.userId, member.user?.name || member.role]),
                    )}
                  />
                  <div className="pagination">
                    <span>
                      {total} {total === 1 ? 'lead' : 'leads'}
                    </span>
                    <div>
                      <button
                        className="button"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </button>
                      <button
                        className="button"
                        disabled={page * 25 >= total}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
          {view === 'Follow-ups' && (
            <>
              <div className="page-title">
                <div>
                  <h1>Follow-ups</h1>
                  <p>Keep your next actions in one place.</p>
                </div>
              </div>
              <div className="toolbar filters">
                {['Today', 'Upcoming', 'Overdue', 'Completed'].map((tab) => (
                  <button
                    key={tab}
                    className={'button ' + (taskTab === tab ? 'primary' : '')}
                    onClick={() => setTaskTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <section className="surface">
                <ul className="row-list">
                  {followups
                    .filter((task) =>
                      taskTab === 'Completed'
                        ? task.status === 'completed'
                        : taskTab === 'Overdue'
                          ? task.status === 'overdue'
                          : taskTab === 'Today'
                            ? (task.status === 'pending' || task.status === 'overdue') &&
                              new Date(task.dueAt).toDateString() === new Date().toDateString()
                            : task.status === 'pending',
                    )
                    .map((task) => (
                      <li key={task._id}>
                        <div>
                          <button className="text-button" onClick={() => open(task.leadId)}>
                            {task.description}
                          </button>
                          <small>
                            {new Date(task.dueAt).toLocaleString()} · {task.priority}
                          </small>
                        </div>
                        {task.status !== 'completed' && (
                          <button
                            className="button"
                            onClick={() =>
                              run(() =>
                                change(
                                  '/followups/' + task._id,
                                  'PATCH',
                                  { status: 'completed' },
                                  'Follow-up completed',
                                ),
                              )
                            }
                          >
                            Complete
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            </>
          )}
          {view === 'Admin panel' && adminPanel && scope && (
            <>
              <div className="page-title">
                <div>
                  <h1>Admin panel</h1>
                  <p>Manage the sheet and client access for {workspace?.name}.</p>
                </div>
                <button className="button" onClick={() => setDialog('workspaces')}>
                  Manage workspaces
                </button>
              </div>
              <GoogleSheets
                key={scope}
                scope={scope}
                refresh={async () => {
                  await state.refreshWorkspace()
                }}
              />
              <section className="surface panel">
                <div className="page-title">
                  <h2>Client access</h2>
                  <div className="toolbar">
                    <button className="button" onClick={() => setDialog('grant-client')}>
                      Grant workspace access
                    </button>
                    <button className="button primary" onClick={() => setDialog('create-client')}>
                      Create client account
                    </button>
                  </div>
                </div>
                <p>Clients can see leads imported into the workspaces you grant them.</p>
                <ul className="row-list">
                  {members
                    .filter((member) => member.role === 'client')
                    .map((member) => (
                      <li key={member._id}>
                        <div className="customer">
                          <Avatar name={member.user?.name || member.role} />
                          <div>
                            {member.user?.name || member.role}
                            <small>{member.user?.email}</small>
                          </div>
                        </div>
                        <button
                          className="button"
                          onClick={() => {
                            if (confirm('Remove this team member?'))
                              run(() =>
                                change('/team/' + member._id, 'DELETE', {}, 'Member removed'),
                              )
                          }}
                        >
                          Revoke access
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            </>
          )}
          {view === 'Settings' && (
            <>
              <div className="page-title">
                <div>
                  <h1>Settings</h1>
                  <p>Workspace profile and timezone.</p>
                </div>
              </div>
              <section className="surface panel">
                {demo ? (
                  <Empty>Workspace settings are available in a live account.</Empty>
                ) : canManage ? (
                  <ActionForm onSave={(input) => change('/workspaces/' + scope, 'PATCH', input)}>
                    <label>
                      Workspace name
                      <input name="name" required defaultValue={workspace?.name} />
                    </label>
                    <label>
                      Timezone
                      <input name="timezone" required defaultValue={workspace?.timezone} />
                    </label>
                  </ActionForm>
                ) : (
                  <p>
                    {workspace?.name} · {workspace?.timezone}
                  </p>
                )}
              </section>
            </>
          )}
        </main>
      </div>
      {dialog === 'add' && (
        <Dialog title="Add lead" onClose={close}>
          <ActionForm
            label="Create lead"
            onSave={async (input) => {
              await change('/leads', 'POST', saveLead(input), 'Lead created')
              close()
            }}
          >
            <LeadFields />
          </ActionForm>
        </Dialog>
      )}
      {dialog === 'details' && (
        <Dialog title={row?.name || 'Lead details'} onClose={close}>
          {details && row ? (
            <>
              <div className="lead-summary">
                <Avatar name={row.name} />
                <div>
                  <strong>{row.company || row.name}</strong>
                  <small>
                    {[row.phone, row.email].filter(Boolean).join(' · ') || 'No contact information'}
                  </small>
                </div>
                <Status value={row.status} />
              </div>
              <div className="toolbar">
                <button className="button" onClick={() => setDialog('edit')}>
                  Edit lead
                </button>
                <button className="button" onClick={() => setDialog('schedule')}>
                  Schedule follow-up
                </button>
              </div>
              <div className="detail-block">
                <h3>Lead information</h3>
                <p>
                  {row.source}
                  {row.campaign ? ' · ' + row.campaign : ''} · Consent {row.consent || 'unknown'}
                </p>
                {!!row.tags?.length && (
                  <div className="toolbar">
                    {row.tags.map((tag) => (
                      <Status key={tag} value={tag} />
                    ))}
                  </div>
                )}
                {row.answers &&
                  Object.entries(row.answers).map(([name, value]) => (
                    <p key={name}>
                      <strong>{name.replaceAll('_', ' ')}</strong>{' '}
                      {Array.isArray(value) ? value.join(', ') : String(value)}
                    </p>
                  ))}
                {canManage && (
                  <label className="assign">
                    Assign to
                    <select
                      value={row.assignedTo || ''}
                      onChange={(e) => {
                        const userId = e.target.value
                        if (userId)
                          run(() =>
                            change(
                              '/leads/' + row._id + '/assign',
                              'POST',
                              { userId },
                              'Lead assigned',
                            ),
                          )
                      }}
                    >
                      <option value="" disabled>
                        Choose teammate
                      </option>
                      {members.map((m) => (
                        <option value={m.userId} key={m._id}>
                          {m.user?.name || m.role}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="detail-block">
                <h3>Notes</h3>
                <ActionForm
                  label="Add note"
                  className="inline-form"
                  onSave={(input) =>
                    change('/leads/' + row._id + '/notes', 'POST', input, 'Note added')
                  }
                >
                  <input aria-label="New note" name="text" required placeholder="Add a note…" />
                </ActionForm>
                {details.notes.map((note) => (
                  <p key={note._id}>{note.text}</p>
                ))}
              </div>
              <div className="detail-block">
                <h3>Follow-ups</h3>
                {details.followUps.length ? (
                  details.followUps.map((task) => (
                    <div className="detail-task" key={task._id}>
                      <p>
                        {shortDate(task.dueAt)} · {task.description} · {task.status}
                      </p>
                      {['pending', 'overdue'].includes(task.status) && (
                        <div className="toolbar">
                          <button
                            className="button"
                            onClick={() => {
                              setRescheduling(task)
                              setDialog('reschedule')
                            }}
                          >
                            Reschedule
                          </button>
                          <button
                            className="button"
                            onClick={() =>
                              run(() =>
                                change(
                                  '/followups/' + task._id,
                                  'PATCH',
                                  { status: 'completed' },
                                  'Follow-up completed',
                                ),
                              )
                            }
                          >
                            Complete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p>No follow-ups scheduled.</p>
                )}
              </div>
              <div className="detail-block">
                <h3>Timeline</h3>
                {details.activities.length ? (
                  details.activities.map((item) => (
                    <p key={item._id}>
                      {shortDate(item.createdAt)} · {item.detail}
                    </p>
                  ))
                ) : (
                  <p>No activity logged.</p>
                )}
              </div>
              {canManage && (
                <button
                  className="button danger"
                  onClick={() => {
                    if (confirm('Archive this lead?'))
                      run(async () => {
                        await change('/leads/' + row._id, 'DELETE', {}, 'Lead archived')
                        close()
                      })
                  }}
                >
                  Archive lead
                </button>
              )}
            </>
          ) : (
            <Empty>
              {detailsQuery.isError ? detailsQuery.error.message : 'Loading lead details…'}
            </Empty>
          )}
        </Dialog>
      )}
      {dialog === 'edit' && row && (
        <Dialog title="Edit lead" onClose={() => setDialog('details')}>
          <ActionForm
            onSave={async (input) => {
              const lead = saveLead(input)
              const { phone, ...details } = lead
              await change('/leads/' + row._id, 'PATCH', {
                ...details,
                ...(input.phone !== (row.phone || '') && { phone }),
              })
              setDialog('details')
            }}
          >
            <LeadFields row={row} />
          </ActionForm>
        </Dialog>
      )}
      {dialog === 'schedule' && row && (
        <Dialog title="Schedule follow-up" onClose={() => setDialog('details')}>
          <ActionForm
            label="Schedule"
            onSave={async (input) => {
              await change('/followups', 'POST', saveTask(input, row._id), 'Follow-up scheduled')
              setDialog('details')
            }}
          >
            <FollowUpFields />
          </ActionForm>
        </Dialog>
      )}
      {dialog === 'reschedule' && rescheduling && (
        <Dialog title="Reschedule follow-up" onClose={() => setDialog('details')}>
          <ActionForm
            label="Reschedule"
            onSave={async (input) => {
              await change(
                '/followups/' + rescheduling._id,
                'PATCH',
                { dueAt: new Date(input.dueAt).toISOString(), status: 'pending' },
                'Follow-up rescheduled',
              )
              setDialog('details')
            }}
          >
            <p>{rescheduling.description}</p>
            <label>
              New due date and time
              <input name="dueAt" type="datetime-local" required />
            </label>
          </ActionForm>
        </Dialog>
      )}
      {dialog === 'workspaces' && (
        <Dialog title="Workspaces" onClose={close}>
          {demo ? (
            <Empty>You are exploring the Orchard Studio demo.</Empty>
          ) : (
            <>
              <ul className="row-list">
                {account.data?.rows.map((item) => (
                  <li key={item._id}>
                    <button
                      className="text-button"
                      onClick={() => {
                        state.setSelected(item._id)
                        go('Overview')
                      }}
                    >
                      {item.name}
                    </button>
                    <span>{item.role}</span>
                  </li>
                ))}
              </ul>
              {crmAdmin && (
                <ActionForm
                  label="Create workspace"
                  onSave={async (input) => {
                    await state.createWorkspace(input.name)
                    go('Admin panel')
                    setToast('Workspace created')
                  }}
                >
                  <label>
                    New workspace name
                    <input name="name" required />
                  </label>
                </ActionForm>
              )}
            </>
          )}
        </Dialog>
      )}
      {adminPanel && ['create-client', 'grant-client'].includes(dialog) && (
        <Dialog
          title={dialog === 'create-client' ? 'Create client account' : 'Grant workspace access'}
          onClose={close}
        >
          <p>Workspace: {workspace?.name}</p>
          <ActionForm
            label={dialog === 'create-client' ? 'Create account' : 'Grant access'}
            onSave={async (input) => {
              await change(
                '/team/clients',
                'POST',
                {
                  ...input,
                  action: dialog === 'create-client' ? 'create' : 'grant',
                },
                'Client access saved',
              )
              close()
            }}
          >
            {dialog === 'create-client' && (
              <label>
                Client name
                <input name="name" required maxLength={160} />
              </label>
            )}
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            {dialog === 'create-client' && (
              <>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <p>Share these sign-in details with the client privately.</p>
              </>
            )}
          </ActionForm>
        </Dialog>
      )}
      {dialog === 'bulk-assign' && (
        <Dialog title="Assign selected leads" onClose={close}>
          <ActionForm
            label="Assign leads"
            onSave={async (input) => {
              await change(
                '/leads/bulk-assign',
                'POST',
                { ids: selection, userId: input.userId },
                'Leads assigned',
              )
              setSelection([])
              close()
            }}
          >
            <label>
              Assign {selection.length} leads to
              <select name="userId" required defaultValue="">
                <option value="" disabled>
                  Choose teammate
                </option>
                {members.map((member) => (
                  <option value={member.userId} key={member._id}>
                    {member.user?.name || member.role}
                  </option>
                ))}
              </select>
            </label>
          </ActionForm>
        </Dialog>
      )}
      {dialog === 'notifications' && (
        <Dialog title="Notifications" onClose={close}>
          {notifications.data?.length ? (
            <ul className="row-list">
              {notifications.data.map((item) => (
                <li key={item._id}>
                  {item.text}
                  {!item.read && (
                    <button
                      className="text-button"
                      onClick={() =>
                        run(() => change('/notifications/' + item._id, 'PATCH', {}, ''))
                      }
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>You’re all caught up.</Empty>
          )}
        </Dialog>
      )}
      {dialog === 'help' && (
        <Dialog title="Help" onClose={close}>
          <p>Open Leads to manage contacts and schedule follow-ups.</p>
          {adminPanel && (
            <button className="button" onClick={() => go('Admin panel')}>
              Open admin panel <ChevronDown size={14} />
            </button>
          )}
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
function ErrorLine({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-line" role="alert">
      {message}
      <button className="button" onClick={retry}>
        Retry
      </button>
    </div>
  )
}
