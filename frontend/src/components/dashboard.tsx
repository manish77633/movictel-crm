'use client'
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  ArrowUpRight,
  CalendarDays,
  CircleDot,
  Facebook,
  Instagram,
  MessageCircle,
  Phone,
  Plus,
  UsersRound,
} from 'lucide-react'
import { type Demo, type Lead, type Report, reportFrom, stages } from '../lib/demo'
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(date),
  )
export function Status({ value }: { value: string }) {
  return (
    <span className={'status ' + value.toLowerCase().replaceAll(' ', '-')}>
      <i />
      {value}
    </span>
  )
}
export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span className={'avatar tone-' + (index % 5)}>
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase()}
    </span>
  )
}
export function Source({ name }: { name: string }) {
  return (
    <span className="source">
      {name === 'Facebook' ? (
        <Facebook size={14} />
      ) : name === 'Instagram' ? (
        <Instagram size={14} />
      ) : (
        <CircleDot size={14} />
      )}{' '}
      {name}
    </span>
  )
}
export function ContactLinks({ phone }: { phone?: string }) {
  const number = phone?.replace(/[\s().-]/g, '').replace(/^00/, '+')
  if (!number || !/^\+?[0-9]{7,15}$/.test(number)) return null
  return (
    <span className="lead-contact-actions">
      <a className="icon-button" href={'tel:' + number} title="Call lead" aria-label="Call lead">
        <Phone size={16} />
      </a>
      {/^\+[1-9][0-9]{7,14}$/.test(number) && (
        <a
          className="icon-button whatsapp-link"
          href={'https://wa.me/' + number.slice(1)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open WhatsApp"
          aria-label="Open WhatsApp"
        >
          <MessageCircle size={17} />
        </a>
      )}
    </span>
  )
}

export function LeadTable({
  rows,
  onOpen,
  preview = false,
  selection,
  onSelect,
  assignees,
}: {
  rows: Lead[]
  onOpen?: (id: string) => void
  preview?: boolean
  selection?: string[]
  onSelect?: (id: string) => void
  assignees?: Record<string, string>
}) {
  if (!rows.length) return <div className="empty">No leads match this view.</div>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selection && (
              <th scope="col">
                <span className="sr-only">Select</span>
              </th>
            )}
            <th>Customer</th>
            {!preview && <th>Phone</th>}
            <th>Source</th>
            <th>Campaign</th>
            {assignees && <th>Assigned to</th>}
            <th>Status</th>
            {assignees && <th>Last contacted</th>}
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row._id}>
              {selection && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={'Select ' + row.name}
                    checked={selection.includes(row._id)}
                    onChange={() => onSelect?.(row._id)}
                  />
                </td>
              )}
              <td>
                <div className="customer">
                  <Avatar name={row.name} index={index} />
                  <div>
                    {onOpen ? (
                      <button className="text-button" onClick={() => onOpen(row._id)}>
                        {row.name}
                      </button>
                    ) : (
                      <strong>{row.name}</strong>
                    )}
                    <small>{row.company || row.email || 'Individual'}</small>
                  </div>
                </div>
              </td>
              {!preview && (
                <td>
                  <div className="lead-phone">
                    {row.phone || '—'}
                    <ContactLinks phone={row.phone} />
                  </div>
                </td>
              )}
              <td>
                <Source name={row.source} />
              </td>
              <td>{row.campaignSheetName || row.campaign || '—'}</td>
              {assignees && (
                <td>{row.assignedTo ? assignees[row.assignedTo] || 'Assigned' : 'Unassigned'}</td>
              )}
              <td>
                <Status value={row.status} />
              </td>
              {assignees && <td>{row.contactedAt ? shortDate(row.contactedAt) : '—'}</td>}
              <td>{shortDate(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function Dashboard({
  data,
  report,
  preview = false,
  onOpen,
  onAdd,
  onLeads,
  extra = false,
}: {
  data?: Demo
  report?: Report
  preview?: boolean
  onOpen?: (id: string) => void
  onAdd?: () => void
  onLeads?: () => void
  extra?: boolean
}) {
  const current = report || (data && reportFrom(data))
  if (!current) return null
  const count = (name: string) => current.stages.find((item) => item._id === name)?.count || 0
  const total = current.stages.reduce((sum, item) => sum + item.count, 0)
  const today = new Date().toISOString().slice(0, 10)
  const metrics = [
    ['Total leads', total, UsersRound],
    ['Uncontacted', count('New'), CircleDot],
    ['Interested', count('Interested'), MessageCircle],
    [
      'Conversion rate',
      total ? Math.round((count('Converted') / total) * 100) + '%' : '0%',
      ArrowUpRight,
    ],
    ...(!preview
      ? ([
          ['New today', current.dates.find((row) => row._id === today)?.count || 0, CalendarDays],
          ['Converted', count('Converted'), ArrowUpRight],
        ] as const)
      : []),
  ] as const
  const chart = current.dates.map((row) => ({
    name: shortDate(row._id + 'T00:00:00Z'),
    count: row.count,
  }))
  return (
    <div className="dashboard">
      <div className="page-title">
        <div>
          <h1>{extra ? 'Analytics' : 'Overview'}</h1>
          <p>
            {extra
              ? 'Lead activity and messaging performance.'
              : 'Your sales activity at a glance.'}
          </p>
        </div>
        {onAdd && (
          <button className="button primary" onClick={onAdd}>
            <Plus size={16} /> Add lead
          </button>
        )}
      </div>
      <div className="metrics">
        {metrics.map(([label, value, Icon]) => (
          <div key={label}>
            <span>
              <Icon size={16} /> {label}
            </span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="surface">
          <header>
            <div>
              <h2>Lead activity</h2>
              <p>New leads over time</p>
            </div>
            <CalendarDays size={17} />
          </header>
          <div className="chart">
            {chart.length ? (
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: 500, height: 185 }}
              >
                <AreaChart data={chart} margin={{ top: 15, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} stroke="#e8edf5" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#66758a' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={26}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#66758a' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="count"
                    name="Leads"
                    stroke="#315de4"
                    fill="#e8efff"
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty">Lead activity will appear here.</div>
            )}
          </div>
        </section>
        <section className="surface source-panel">
          <header>
            <div>
              <h2>Lead sources</h2>
              <p>Where new leads came from</p>
            </div>
          </header>
          {current.sources.length ? (
            current.sources.map((row, index) => (
              <div className="source-item" key={row._id}>
                <div>
                  <Source name={row._id || 'Unknown'} />
                  <strong>{row.count}</strong>
                </div>
                <progress
                  className={'progress-' + (index % 3)}
                  max={total || 1}
                  value={row.count}
                />
              </div>
            ))
          ) : (
            <div className="empty">No sources yet.</div>
          )}
        </section>
      </div>
      {extra ? (
        <>
          <div className="dashboard-grid">
            <section className="surface">
              <header>
                <h2>Pipeline breakdown</h2>
              </header>
              <ul className="row-list">
                {stages.map((stage) => (
                  <li key={stage}>
                    <Status value={stage} />
                    <strong>{count(stage)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="dashboard-grid">
            {(
              [
                ['Leads by campaign', current.campaigns],
                ['Leads by source', current.sources],
              ] as const
            ).map(([label, rows]) => (
              <section className="surface" key={label}>
                <header>
                  <h2>{label}</h2>
                </header>
                {rows?.length ? (
                  <ul className="row-list">
                    {rows.map((item) => (
                      <li key={item._id}>
                        {item._id || 'Unspecified'} <strong>{item.count}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty">No breakdown for this range.</div>
                )}
              </section>
            ))}
          </div>
        </>
      ) : (
        <section className="surface">
          <header>
            <div>
              <h2>Recent leads</h2>
              <p>Latest contacts in your workspace</p>
            </div>
            {onLeads && (
              <button className="button" onClick={onLeads}>
                View leads <ArrowUpRight size={15} />
              </button>
            )}
          </header>
          <LeadTable
            rows={current.recent.slice(0, preview ? 4 : 6)}
            preview={preview}
            onOpen={onOpen}
          />
        </section>
      )}
    </div>
  )
}
