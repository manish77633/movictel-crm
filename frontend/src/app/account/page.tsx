'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AudioLines, ArrowRight } from 'lucide-react'
import { Suspense, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'

const titles: Record<string, string> = {
  login: 'Welcome back',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
  verify: 'Verify your email',
  invite: 'Join a workspace',
}
function AccountForm() {
  const params = useSearchParams()
  const requested = params.get('mode') || 'login'
  const mode = Object.hasOwn(titles, requested) ? requested : 'login'
  const router = useRouter()
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    const token = params.get('token')
    const routes: Record<string, string> = {
      forgot: 'forgot-password',
      reset: 'reset-password',
      invite: 'accept-invite',
    }
    try {
      const result = await api<{ verify?: boolean }>(
        '/auth/' + (routes[mode] || mode),
        undefined,
        'POST',
        { ...fields, ...(token && { token }) },
      )
      if (result.verify) setInfo('Check your email to verify your account.')
      else if (mode === 'forgot')
        setInfo('If the account exists, check your email for a reset link.')
      else if (mode === 'reset') router.push('/account')
      else router.push('/workspace')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="account">
      <Link href="/" className="brand">
        <AudioLines size={24} />
        Relay
      </Link>
      <section className="surface">
        <h1>{titles[mode]}</h1>
        <form onSubmit={submit} className="form">
          {mode === 'invite' && (
            <label>
              Full name
              <input required name="name" autoComplete="name" />
            </label>
          )}
          {['login', 'forgot'].includes(mode) && (
            <label>
              Email
              <input type="email" name="email" autoComplete="email" required />
            </label>
          )}
          {['login', 'reset', 'invite'].includes(mode) && (
            <label>
              Password
              <input
                type="password"
                name="password"
                required
                minLength={12}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {info && <p role="status">{info}</p>}
          <button disabled={busy} className="button primary">
            {busy ? 'Working…' : mode === 'login' ? 'Log in' : titles[mode]}{' '}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="account-links">
          {mode === 'login' ? (
            <p>Contact your CRM admin for account access.</p>
          ) : (
            <Link href="/account">Back to log in</Link>
          )}
        </div>
        <Link className="text-button" href="/workspace?demo=1">
          Explore the demo
        </Link>
      </section>
    </main>
  )
}
export default function Account() {
  return (
    <Suspense fallback={<p>Loading account…</p>}>
      <AccountForm />
    </Suspense>
  )
}
