import Link from 'next/link'
import {
  ArrowRight,
  AudioLines,
  ChartNoAxesCombined,
  ChevronRight,
  Facebook,
  MessageCircle,
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
          <a href="#pricing">Pricing</a>
        </nav>
        <div>
          <Link href="/account">Log in</Link>
          <Link className="button primary" href="/account?mode=register">
            Get started <ArrowRight size={15} />
          </Link>
        </div>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <div className="integration-label">
            <Facebook size={15} /> <MessageCircle size={15} /> Built for teams selling on WhatsApp
          </div>
          <h1>Turn every lead into a conversation.</h1>
          <p>
            Capture Facebook leads instantly, automate WhatsApp engagement, and manage your entire
            sales pipeline from one powerful workspace.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/account?mode=register">
              Get Started Free <ArrowRight size={16} />
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
              {['Overview', 'Leads', 'Pipeline', 'Inbox', 'Automations'].map((item) => (
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
        <h2>Your ads and conversations, connected</h2>
        <div className="split">
          <article>
            <Facebook />
            <h3>Facebook and Instagram Lead Ads</h3>
            <p>Bring Instant Form submissions into a shared queue for your team.</p>
          </article>
          <article>
            <MessageCircle />
            <h3>WhatsApp Business</h3>
            <p>Reply from a shared workspace and send approved templates to eligible customers.</p>
          </article>
        </div>
      </section>
      <section id="workflow" className="section">
        <h2>From form submission to follow-up</h2>
        <ol className="split three">
          <li>
            <h3>Capture</h3>
            <p>Connect a lead form or add a lead manually.</p>
          </li>
          <li>
            <h3>Respond</h3>
            <p>Assign the lead and record your first conversation.</p>
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
            <MessageCircle />
            <h3>WhatsApp follow-ups</h3>
            <p>Work from a shared inbox and manage message templates.</p>
          </article>
          <article>
            <ChartNoAxesCombined />
            <h3>Pipeline and analytics</h3>
            <p>Track sales stages and see where your leads come from.</p>
          </article>
        </div>
        <p>For agencies, real estate teams, schools, dealerships, and growing businesses.</p>
      </section>
      <section id="pricing" className="section">
        <h2>Try the workspace</h2>
        <p>The interactive demo is free and uses sample data.</p>
        <Link className="button" href="/workspace?demo=1">
          Explore the demo <ArrowRight size={16} />
        </Link>
      </section>
      <section className="section">
        <h2>Frequently asked questions</h2>
        <details>
          <summary>Do I need a Meta account to try Relay?</summary>
          <p>
            You can use the demo without signing in. Live integrations require authorized Meta
            business assets.
          </p>
        </details>
        <details>
          <summary>Can I control who sees each lead?</summary>
          <p>
            Workspace owners and admins can assign leads. Sales agents can work with leads assigned
            to them.
          </p>
        </details>
      </section>
      <footer className="section">
        <h2>Start with your next lead</h2>
        <Link className="button primary" href="/account?mode=register">
          Create a workspace
        </Link>
        <p>Relay · Lead management for sales teams</p>
      </footer>
    </main>
  )
}
