import MailLayoutClient from '@/components/mail/MailLayoutClient'

export default function MailLayout({ children }: { children: React.ReactNode }) {
  return <MailLayoutClient>{children}</MailLayoutClient>
}
