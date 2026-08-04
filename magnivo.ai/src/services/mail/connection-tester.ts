import type {
  MailboxProvider,
  WizardTestResult,
  WizardSMTPValues,
  WizardIMAPValues,
} from '@/types/mail'
import { testSMTPConnection, sendTestEmail, type SMTPTestInput } from './smtp-validator'
import { testIMAPConnection, verifyInboxReadAccess, type IMAPTestInput } from './imap-validator'
import { mailErrorToTestResult } from './errors'

export type ConnectionTestInput = {
  provider: MailboxProvider
  email: string
  smtp: WizardSMTPValues
  imap: WizardIMAPValues
  /** When true (default), also send a test email and verify IMAP can SELECT INBOX */
  fullVerification?: boolean
}

type SubTestResult = {
  name: string
  passed: boolean
  result?: WizardTestResult
}

async function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timed out')), ms)
    ),
  ])
}

export async function testConnection(input: ConnectionTestInput): Promise<WizardTestResult> {
  const tests: SubTestResult[] = []
  const full = input.fullVerification !== false

  const smtpHost = input.smtp.smtpHost
  const smtpUser = input.smtp.smtpUsername || input.email
  const smtpPass = input.smtp.smtpPassword

  if (!smtpHost || !smtpPass) {
    return {
      status: 'failure',
      errorType: 'validation',
      message: 'SMTP host and password are required for connection testing.',
    }
  }

  const smtpInput: SMTPTestInput = {
    host: smtpHost,
    port: Number(input.smtp.smtpPort) || 587,
    encryption: input.smtp.encryption,
    username: smtpUser,
    password: smtpPass,
  }

  const smtpResult = await runWithTimeout(() => testSMTPConnection(smtpInput), 15000)
  tests.push({
    name: 'SMTP',
    passed: smtpResult.success,
    result: smtpResult.success
      ? { status: 'success', message: 'SMTP connection verified.' }
      : smtpResult.error
        ? mailErrorToTestResult(smtpResult.error)
        : { status: 'failure', errorType: 'unknown', message: 'SMTP test failed.' },
  })

  const imapHost = input.imap.imapHost || smtpHost.replace(/^smtp\./i, 'imap.')
  const imapUser = input.imap.imapUsername || smtpUser
  const imapPass = input.imap.imapPassword || smtpPass

  if (imapHost) {
    const imapInput: IMAPTestInput = {
      host: imapHost,
      port: Number(input.imap.imapPort) || 993,
      ssl: input.imap.imapSsl !== false,
      username: imapUser,
      password: imapPass,
    }
    const imapResult = await runWithTimeout(() => testIMAPConnection(imapInput), 15000)
    tests.push({
      name: 'IMAP',
      passed: imapResult.success,
      result: imapResult.success
        ? { status: 'success', message: 'IMAP connection verified.' }
        : imapResult.error
          ? mailErrorToTestResult(imapResult.error)
          : { status: 'failure', errorType: 'unknown', message: 'IMAP test failed.' },
    })

    if (full && smtpResult.success && imapResult.success) {
      const testToken = `magnivo-test-${Date.now()}`
      const sendResult = await runWithTimeout(
        () =>
          sendTestEmail({
            ...smtpInput,
            from: input.email,
            to: input.email,
            subject: `Magnivo connection test ${testToken}`,
            text: `Connection test token: ${testToken}`,
          }),
        20000
      )
      tests.push({
        name: 'Send test email',
        passed: sendResult.success,
        result: sendResult.success
          ? { status: 'success', message: 'Test email sent successfully.' }
          : sendResult.error
            ? mailErrorToTestResult(sendResult.error)
            : { status: 'failure', errorType: 'unknown', message: 'Failed to send test email.' },
      })

      if (sendResult.success) {
        const readResult = await runWithTimeout(
          () => verifyInboxReadAccess(imapInput),
          20000
        )
        tests.push({
          name: 'Inbox read',
          passed: readResult.success,
          result: readResult.success
            ? { status: 'success', message: 'Inbox read access verified.' }
            : readResult.error
              ? mailErrorToTestResult(readResult.error)
              : { status: 'failure', errorType: 'unknown', message: 'Failed to verify inbox read access.' },
        })
      }
    }
  } else if (full) {
    tests.push({
      name: 'IMAP',
      passed: false,
      result: {
        status: 'failure',
        errorType: 'validation',
        message: 'IMAP host is required to verify inbox read access before saving.',
      },
    })
  }

  if (tests.length === 0) {
    return { status: 'failure', errorType: 'unknown', message: 'No connection tests were run.' }
  }

  const allPassed = tests.every((t) => t.passed)
  const steps = tests.map((t) => ({
    name: t.name,
    passed: t.passed,
    detail: t.result?.message,
  }))

  if (allPassed) {
    const names = tests.map((t) => t.name).join(' + ')
    return { status: 'success', message: `${names} verified successfully.`, steps }
  }

  const failed = tests.find((t) => !t.passed)
  if (failed?.result) {
    return { ...failed.result, steps }
  }
  return { status: 'failure', errorType: 'unknown', message: 'Connection test failed.', steps }
}

export async function testOAuthConnection(
  provider: MailboxProvider,
  email: string
): Promise<WizardTestResult> {
  if (!email || !email.includes('@')) {
    return { status: 'failure', errorType: 'validation', message: 'A valid email is required.' }
  }
  if (provider === 'custom') {
    return {
      status: 'failure',
      errorType: 'validation',
      message: 'Custom providers must use SMTP/IMAP testing.',
    }
  }
  // Pre-consent: validate email shape. Post-consent verification runs in
  // completeGmailOAuthConnect / createMailboxWithOAuth (profile + inbox read).
  return {
    status: 'success',
    message: `Ready for ${provider} OAuth. After consent Magnivo verifies send + inbox read scopes before marking Connected.`,
  }
}
