'use client'
import { useState } from 'react'
import { RefreshCw, Sheet } from 'lucide-react'
import { api } from '../lib/api'
import { ActionForm } from './crm-forms'
import { useApi } from './workspace-data'

const path = '/integrations/google-sheets'
export type CampaignSheet = {
  _id: string
  campaignName: string
  tabName: string
  lastSyncAt?: string
}
type SheetSettings = {
  viewerEmail: string
  connections: (CampaignSheet & { lastImported?: number; skipped?: number; error?: string })[]
}

export function useSheetSync(scope: string | undefined, refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; warning: boolean }>()
  async function sync(campaignSheetId?: string) {
    if (!scope || busy) return
    setBusy(true)
    setFeedback(undefined)
    try {
      const result = await api<{ imported: number; skipped: number; issues?: string[] }>(
        path + '/sync',
        scope,
        'POST',
        { campaignSheetId },
      )
      const imported = result.imported
      setFeedback({
        message: [
          imported
            ? imported + (imported === 1 ? ' new lead imported.' : ' new leads imported.')
            : 'No new leads imported.',
          result.skipped ? result.skipped + ' rows skipped. Check the Lead ID column.' : '',
          ...(result.issues ?? []),
        ]
          .filter(Boolean)
          .join(' '),
        warning: !!result.issues?.length || result.skipped > 0,
      })
    } catch (error) {
      setFeedback({ message: (error as Error).message, warning: true })
    } finally {
      try {
        await refresh()
      } finally {
        setBusy(false)
      }
    }
  }
  return { busy, feedback, sync }
}

export function SyncFeedback({ feedback }: { feedback?: { message: string; warning: boolean } }) {
  if (!feedback) return null
  return (
    <p className={feedback.warning ? 'error' : undefined} role="status">
      {feedback.message}
    </p>
  )
}

export function GoogleSheets({ scope, refresh }: { scope: string; refresh: () => Promise<void> }) {
  const query = useApi<SheetSettings>(scope, path)
  const [adding, setAdding] = useState(false)
  const { busy, sync, feedback } = useSheetSync(scope, refresh)
  const rows = query.data?.connections || []
  return (
    <section className="surface panel campaign-panel">
      <div className="campaign-panel-header">
        <div className="integration-heading">
          <span className="integration-icon">
            <Sheet size={23} />
          </span>
          <div>
            <h2>Campaign sheets</h2>
            <p>Connect a sheet for each campaign this client should see.</p>
          </div>
        </div>
        {!!rows.length && (
          <button type="button" className="button" onClick={() => void sync()} disabled={busy}>
            <RefreshCw size={15} /> {busy ? 'Syncing�' : 'Sync all'}
          </button>
        )}
      </div>
      {query.isPending && <p>Checking connections�</p>}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && !query.data.viewerEmail && (
        <p>Set up Google Sheets credentials on the backend.</p>
      )}
      {!!rows.length && (
        <ul className="row-list campaign-connections">
          {rows.map((row) => (
            <li key={row._id}>
              <div>
                <strong>{row.campaignName || row.tabName}</strong>
                <small>
                  {row.lastSyncAt
                    ? 'Last synced ' + new Date(row.lastSyncAt).toLocaleString()
                    : 'Waiting for first sync'}
                </small>
                {!!row.skipped && (
                  <small>
                    {row.skipped} rows skipped because their Lead ID is missing or invalid.
                  </small>
                )}
                {row.error && <small className="error">{row.error}</small>}
              </div>
              <button
                className="button"
                type="button"
                onClick={() => void sync(row._id)}
                disabled={busy}
              >
                Sync now
              </button>
            </li>
          ))}
        </ul>
      )}
      <SyncFeedback feedback={feedback} />
      {query.data?.viewerEmail &&
        (adding || !rows.length ? (
          <ActionForm
            label="Connect campaign sheet"
            onSave={async (input) => {
              await api(path, scope, 'POST', input)
              setAdding(false)
              await refresh()
            }}
          >
            <p>
              Share the spreadsheet as Viewer with <strong>{query.data.viewerEmail}</strong>.
              Include a stable Lead ID column.
            </p>
            <div className="form-grid">
              <label>
                Campaign name
                <input
                  name="campaignName"
                  placeholder="Summer enquiry campaign"
                  maxLength={160}
                  required
                />
              </label>
              <label>
                Google Sheets tab link
                <input
                  name="url"
                  type="url"
                  placeholder="https://docs.google.com/spreadsheets/d/�"
                  maxLength={1000}
                  required
                />
              </label>
            </div>
          </ActionForm>
        ) : (
          <button className="button primary" type="button" onClick={() => setAdding(true)}>
            Add campaign sheet
          </button>
        ))}
    </section>
  )
}
