import type { Metadata } from 'next'
import './styles.css'
export const metadata: Metadata = {
  title: 'Relay — Lead management',
  description: 'Import Google Sheets leads and manage client workspaces.',
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
