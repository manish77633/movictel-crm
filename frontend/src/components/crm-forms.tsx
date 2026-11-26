'use client'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { stages, type Lead } from '../lib/demo'
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const node = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    node.current?.showModal()
  }, [])
  return (
    <dialog
      ref={node}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog-content">
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
export function ActionForm({
  children,
  label = 'Save',
  onSave,
  className = 'form',
}: {
  children: ReactNode
  label?: string
  onSave: (input: Record<string, string>) => Promise<void>
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = event.currentTarget
    try {
      await onSave(Object.fromEntries(new FormData(form)) as Record<string, string>)
      if (form.dataset.reset === 'yes') form.reset()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className={className}
      onSubmit={submit}
      data-reset={className === 'inline-form' ? 'yes' : undefined}
    >
      {children}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? 'Saving…' : label}
      </button>
    </form>
  )
}
export function LeadFields({ row }: { row?: Lead }) {
  return (
    <>
      <label>
        Full name
        <input name="name" required maxLength={160} defaultValue={row?.name} />
      </label>
      <div className="form-grid">
        <label>
          Phone
          <input
            name="phone"
            type="tel"
            placeholder="+91 98765 43210"
            defaultValue={row?.phone}
            autoComplete="tel"
            maxLength={30}
          />
        </label>
        <label>
          Email
          <input name="email" type="email" defaultValue={row?.email} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Company
          <input name="company" defaultValue={row?.company} />
        </label>
        <label>
          Campaign
          <input name="campaign" defaultValue={row?.campaign} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Status
          <select name="status" defaultValue={row?.status ?? 'New'}>
            {stages.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Tags
        <input
          name="tags"
          defaultValue={row?.tags?.join(', ')}
          placeholder="Comma-separated tags"
        />
      </label>
    </>
  )
}
export function FollowUpFields() {
  return (
    <>
      <label>
        What needs to happen?
        <input name="description" maxLength={1000} required />
      </label>
      <div className="form-grid">
        <label>
          Due date and time
          <input type="datetime-local" name="dueAt" required />
        </label>
        <label>
          Priority
          <select name="priority">
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
    </>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
