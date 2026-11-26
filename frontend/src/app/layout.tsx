import type { Metadata } from 'next'
import './styles.css'
export const metadata: Metadata = {
  title: 'Relay — Lead management',
  description: 'Manage leads and WhatsApp conversations in one workspace.',
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
