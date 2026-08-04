import nodemailer from 'nodemailer'
import type { SMTPEncryption } from '@/types/mail'
import { classifyError, type MailError } from './errors'

export type SMTPTestInput = {
  host: string
  port: number
  encryption: SMTPEncryption
  username: string
  password: string
}

export type SMTPTestResult = {
  success: boolean
  error?: MailError
}

export async function testSMTPConnection(input: SMTPTestInput): Promise<SMTPTestResult> {
  const secure = input.encryption === 'ssl'
  const port = input.port || (secure ? 465 : 587)

  const transport = nodemailer.createTransport({
    host: input.host,
    port,
    secure,
    auth: {
      user: input.username,
      pass: input.password,
    },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    tls: {
      rejectUnauthorized: input.encryption !== 'none',
    },
  })

  try {
    await transport.verify()
    return { success: true }
  } catch (err) {
    return { success: false, error: classifyError(err, 'smtp') }
  } finally {
    transport.close()
  }
}

export type SMTPSendTestInput = SMTPTestInput & {
  from: string
  to: string
  subject?: string
  text?: string
}

export async function sendTestEmail(input: SMTPSendTestInput): Promise<SMTPTestResult> {
  const secure = input.encryption === 'ssl'
  const port = input.port || (secure ? 465 : 587)

  const transport = nodemailer.createTransport({
    host: input.host,
    port,
    secure,
    auth: {
      user: input.username,
      pass: input.password,
    },
    connectionTimeout: 10000,
    tls: {
      rejectUnauthorized: input.encryption !== 'none',
    },
  })

  try {
    await transport.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject || 'Magnivo AI — Connection Test',
      text:
        input.text ||
        'This is a connection test email from Magnivo AI. If you received this, your SMTP settings are correct.',
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: classifyError(err, 'smtp') }
  } finally {
    transport.close()
  }
}
