import Link from 'next/link'
import {
  ArrowRight,
  AudioLines,
  ChartNoAxesCombined,
  ChevronRight,
  Sheet,
  CalendarDays,
  Play,
  UsersRound,
} from 'lucide-react'
import { Dashboard } from '../components/dashboard'
import { sampleData } from '../lib/demo'

export default function Home() {
  return (
    <main className="marketing">
      <header className="site-header">
        <Link className="brand" href="/">
          <AudioLines size={21} />
          Relay
        </Link>
        <nav aria-label="Marketing">
          <a href="#features">Features</a>
          <a href="#workflow">How it works</a>
          <a href="#integrations">Integrations</a>
          <a href="#demo">Demo</a>
        </nav>
        <div>
          <Link className="button primary" href="/account">
            Log in
          </Link>
        </div>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <div className="integration-label">
            <Sheet size={15} /> Google Sheets lead intake
          </div>
          <h1>From Google Sheets to your sales pipeline.</h1>
          <p>
            Import leads, track follow-ups, and give clients access to the workspaces you choose.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/account">
              Log in <ArrowRight size={16} />
            </Link>
            <Link className="button" href="/workspace?demo=1">
              <Play size={15} /> Open interactive demo
            </Link>
          </div>
        </div>
        <div className="product-preview">
          <div className="window-bar">
            <span />
            <span />
            <span />
            <p>Relay workspace preview · Sample data</p>
          </div>
          <div className="preview-body">
            <aside>
              <strong className="brand">
                <AudioLines size={17} />
                Relay
              </strong>
              {['Overview', 'Leads', 'Pipeline', 'Follow-ups', 'Analytics'].map((item) => (
                <div className={item === 'Overview' ? 'selected' : ''} key={item}>
                  <ChevronRight size={13} />
                  {item}
                </div>
              ))}
            </aside>
            <div>
              <Dashboard data={sampleData()} preview />
            </div>
          </div>
        </div>
      </section>
      <section id="integrations" className="section">
        <h2>Lead intake and workspace access</h2>
        <div className="split">
          <article>
            <Sheet />
            <h3>Google Sheets</h3>
            <p>Connect a spreadsheet and sync new leads into its workspace.</p>
          </article>
          <article>
            <UsersRound />
            <h3>Client access</h3>
            <p>Create client accounts and choose which workspaces they can open.</p>
          </article>
        </div>
      </section>
      <section id="workflow" className="section">
        <h2>From spreadsheet to follow-up</h2>
        <ol className="split three">
          <li>
            <h3>Capture</h3>
            <p>Connect a spreadsheet or add a lead manually.</p>
          </li>
          <li>
            <h3>Respond</h3>
            <p>Assign the lead and record your next step.</p>
          </li>
          <li>
            <h3>Follow up</h3>
            <p>Schedule the next action and move the lead through your pipeline.</p>
          </li>
        </ol>
      </section>
      <section id="features" className="section">
        <h2>A workspace for the whole sales team</h2>
        <div className="split three">
          <article>
            <UsersRound />
            <h3>Lead management</h3>
            <p>Search, assign, and keep notes on every lead.</p>
          </article>
          <article>
            <CalendarDays />
            <h3>Follow-up tasks</h3>
            <p>Schedule tasks and see what is due.</p>
          </article>
          <article>
            <ChartNoAxesCombined />
            <h3>Pipeline and analytics</h3>
            <p>Track sales stages and see where your leads come from.</p>
          </article>
        </div>
        <p>For agencies, real estate teams, schools, dealerships, and growing businesses.</p>
      </section>
      <section id="demo" className="section">
        <h2>Try the workspace</h2>
        <p>The interactive demo is free and uses sample data.</p>
        <Link className="button" href="/workspace?demo=1">
          Explore the demo <ArrowRight size={16} />
        </Link>
      </section>
      <section className="section">
        <h2>Frequently asked questions</h2>
        <details>
          <summary>Can I control who sees each lead?</summary>
          <p>Admins choose which sheet workspaces each client can access.</p>
        </details>
      </section>
      <footer className="section">
        <h2>Start with your next lead</h2>
        <Link className="button primary" href="/account">
          Log in
        </Link>
        <p>Relay · Lead management for sales teams</p>
      </footer>
    </main>
  )
}
