'use client'
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="account">
      <section className="surface">
        <h1>Something went wrong</h1>
        <p>Try loading this page again.</p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  )
}
