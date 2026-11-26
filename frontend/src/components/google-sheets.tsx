'use client'
import { useState } from 'react'
import { Sheet } from 'lucide-react'
import { api } from '../lib/api'
import { ActionForm } from './crm-forms'
import { useApi } from './workspace-data'

const path = '/integrations/google-sheets'
type SheetSettings = {
  viewerEmail: string
  connection: {
    tabName: string
    lastSyncAt?: string
    lastImported?: number
    skipped?: number
    error?: string
  } | null
}

export function GoogleSheets({ scope, refresh }: { scope: string; refresh: () => Promise<void> }) {
  const query = useApi<SheetSettings>(scope, path)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const row = query.data?.connection

  async function sync() {
    setBusy(true)
    setError('')
    setResult('')
    try {
      const { imported } = await api<{ imported: number }>(path + '/sync', scope, 'POST')
      setResult(imported === 1 ? '1 new lead imported.' : imported + ' new leads imported.')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  return (
    <section className="surface panel">
      <div className="integration-heading">
        <span className="integration-icon">
          <Sheet size={23} />
        </span>
        <div>
          <h2>Google Sheets</h2>
          <p>Import leads into this workspace.</p>
        </div>
      </div>
      {query.isPending && <p>Checking connection…</p>}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && !query.data.viewerEmail && (
        <p>Set up Google Sheets credentials on the backend.</p>
      )}
      {query.data?.viewerEmail && !row && (
        <ActionForm
          label="Connect sheet"
          onSave={async (input) => {
            await api(path, scope, 'POST', { url: input.url })
            await refresh()
          }}
        >
          <p>
            Share the spreadsheet as Viewer with <strong>{query.data.viewerEmail}</strong>.
          </p>
          <label>
            Leads tab link
            <input
              name="url"
              type="url"
              placeholder="https://docs.google.com/spreadsheets/d/…"
              maxLength={1000}
              required
            />
          </label>
          <p>
            The first sync imports existing rows. Include a stable Lead ID in the first-row headers.
          </p>
        </ActionForm>
      )}
      {row && (
        <>
          <p>
            Connected tab <strong>{row.tabName}</strong>
          </p>
          <p>
            {row.lastSyncAt
              ? 'Last successful sync ' + new Date(row.lastSyncAt).toLocaleString()
              : 'Waiting for first sync.'}
          </p>
          {!!row.skipped && (
            <p>{row.skipped} rows skipped because their Lead ID is missing or invalid.</p>
          )}
          {(error || row.error) && (
            <p className="error" role="alert">
              {error || row.error}
            </p>
          )}
          {result && <p role="status">{result}</p>}
          <button type="button" className="button" onClick={() => void sync()} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </>
      )}
    </section>
  )
}
