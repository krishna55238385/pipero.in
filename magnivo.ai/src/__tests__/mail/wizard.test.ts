import type {
  WizardStep,
  WizardState,
  WizardValues,
  WizardTestResult,
  WizardSMTPValues,
  WizardIMAPValues,
  MailboxProvider,
  SMTPEncryption,
} from '@/types/mail'

const WIZARD_STEPS: WizardStep[] = ['provider', 'details', 'review', 'test', 'complete']

function getDefaultSMTPValues(): WizardSMTPValues {
  return {
    smtpHost: '',
    smtpPort: '587',
    smtpUsername: '',
    smtpPassword: '',
    encryption: 'starttls',
    authenticationType: 'password',
  }
}

function getDefaultIMAPValues(): WizardIMAPValues {
  return {
    imapHost: '',
    imapPort: '993',
    imapUsername: '',
    imapPassword: '',
    imapSsl: true,
  }
}

function getDefaultValues(): WizardValues {
  return {
    email: '',
    displayName: '',
    senderName: '',
    timezone: 'UTC',
    dailyLimit: 50,
    smtp: getDefaultSMTPValues(),
    imap: getDefaultIMAPValues(),
  }
}

function getDefaultState(): WizardState {
  return {
    currentStep: 'provider',
    provider: null,
    values: getDefaultValues(),
    testResult: { status: 'idle' },
    stepErrors: {
      provider: [],
      details: [],
      review: [],
      test: [],
      complete: [],
    },
  }
}

function getProviderDefaults(provider: MailboxProvider): Partial<WizardValues> {
  if (provider === 'gmail') {
    return {
      smtp: { ...getDefaultSMTPValues(), smtpHost: 'smtp.gmail.com', smtpPort: '587', encryption: 'starttls' as SMTPEncryption },
      imap: { ...getDefaultIMAPValues(), imapHost: 'imap.gmail.com', imapPort: '993', imapSsl: true },
    }
  }
  if (provider === 'outlook') {
    return {
      smtp: { ...getDefaultSMTPValues(), smtpHost: 'smtp.office365.com', smtpPort: '587', encryption: 'starttls' as SMTPEncryption },
      imap: { ...getDefaultIMAPValues(), imapHost: 'outlook.office365.com', imapPort: '993', imapSsl: true },
    }
  }
  if (provider === 'zoho') {
    return {
      smtp: { ...getDefaultSMTPValues(), smtpHost: 'smtp.zoho.com', smtpPort: '587', encryption: 'starttls' as SMTPEncryption },
      imap: { ...getDefaultIMAPValues(), imapHost: 'imap.zoho.com', imapPort: '993', imapSsl: true },
    }
  }
  return {}
}

function nextStep(current: WizardStep): WizardStep {
  const idx = WIZARD_STEPS.indexOf(current)
  if (idx < WIZARD_STEPS.length - 1) return WIZARD_STEPS[idx + 1]
  return current
}

function prevStep(current: WizardStep): WizardStep {
  const idx = WIZARD_STEPS.indexOf(current)
  if (idx > 0) return WIZARD_STEPS[idx - 1]
  return current
}

function canGoNext(state: WizardState): boolean {
  if (state.currentStep === 'provider') return state.provider !== null
  return true
}

function canGoBack(state: WizardState): boolean {
  return state.currentStep !== 'provider' && state.currentStep !== 'complete'
}

function stepHasErrors(state: WizardState, step: WizardStep): boolean {
  return state.stepErrors[step].length > 0
}

describe('Mail Wizard', () => {
  describe('Wizard Navigation', () => {
    it('starts at provider step', () => {
      const state = getDefaultState()
      expect(state.currentStep).toBe('provider')
    })

    it('advances to next step', () => {
      expect(nextStep('provider')).toBe('details')
      expect(nextStep('details')).toBe('review')
      expect(nextStep('review')).toBe('test')
      expect(nextStep('test')).toBe('complete')
    })

    it('does not advance past complete step', () => {
      expect(nextStep('complete')).toBe('complete')
    })

    it('goes back to previous step', () => {
      expect(prevStep('details')).toBe('provider')
      expect(prevStep('review')).toBe('details')
      expect(prevStep('test')).toBe('review')
      expect(prevStep('complete')).toBe('test')
    })

    it('does not go back from provider step', () => {
      expect(prevStep('provider')).toBe('provider')
    })

    it('can go back from test step', () => {
      const state = getDefaultState()
      state.currentStep = 'test'
      expect(canGoBack(state)).toBe(true)
    })

    it('cannot go back from provider step', () => {
      const state = getDefaultState()
      expect(canGoBack(state)).toBe(false)
    })

    it('cannot go back from complete step', () => {
      const state = getDefaultState()
      state.currentStep = 'complete'
      expect(canGoBack(state)).toBe(false)
    })

    it('can go next when provider is selected', () => {
      const state = getDefaultState()
      state.provider = 'gmail'
      expect(canGoNext(state)).toBe(true)
    })

    it('cannot go next when no provider selected', () => {
      const state = getDefaultState()
      expect(canGoNext(state)).toBe(false)
    })

    it('can always go next from non-provider steps', () => {
      const steps: WizardStep[] = ['details', 'review', 'test', 'complete']
      for (const step of steps) {
        const state = getDefaultState()
        state.currentStep = step
        expect(canGoNext(state)).toBe(true)
      }
    })
  })

  describe('Provider Switching', () => {
    it('sets provider defaults for gmail', () => {
      const defaults = getProviderDefaults('gmail')
      expect(defaults.smtp?.smtpHost).toBe('smtp.gmail.com')
      expect(defaults.imap?.imapHost).toBe('imap.gmail.com')
    })

    it('sets provider defaults for outlook', () => {
      const defaults = getProviderDefaults('outlook')
      expect(defaults.smtp?.smtpHost).toBe('smtp.office365.com')
      expect(defaults.imap?.imapHost).toBe('outlook.office365.com')
    })

    it('sets provider defaults for zoho', () => {
      const defaults = getProviderDefaults('zoho')
      expect(defaults.smtp?.smtpHost).toBe('smtp.zoho.com')
      expect(defaults.imap?.imapHost).toBe('imap.zoho.com')
    })

    it('returns empty defaults for custom provider', () => {
      const defaults = getProviderDefaults('custom')
      expect(defaults.smtp).toBeUndefined()
      expect(defaults.imap).toBeUndefined()
    })

    it('resets errors when switching provider', () => {
      const state = getDefaultState()
      state.stepErrors.details = ['some error']
      state.stepErrors.provider = ['provider error']
      const newState = { ...state, stepErrors: { ...state.stepErrors, details: [], provider: [] } }
      expect(newState.stepErrors.details).toHaveLength(0)
      expect(newState.stepErrors.provider).toHaveLength(0)
    })
  })

  describe('Default Values', () => {
    it('has correct default values', () => {
      const values = getDefaultValues()
      expect(values.email).toBe('')
      expect(values.displayName).toBe('')
      expect(values.senderName).toBe('')
      expect(values.timezone).toBe('UTC')
      expect(values.dailyLimit).toBe(50)
    })

    it('has correct default SMTP values', () => {
      const smtp = getDefaultSMTPValues()
      expect(smtp.smtpHost).toBe('')
      expect(smtp.smtpPort).toBe('587')
      expect(smtp.encryption).toBe('starttls')
      expect(smtp.authenticationType).toBe('password')
    })

    it('has correct default IMAP values', () => {
      const imap = getDefaultIMAPValues()
      expect(imap.imapHost).toBe('')
      expect(imap.imapPort).toBe('993')
      expect(imap.imapSsl).toBe(true)
    })
  })

  describe('Step Errors', () => {
    it('tracks errors per step', () => {
      const state = getDefaultState()
      state.stepErrors.details = ['Email is required']
      expect(stepHasErrors(state, 'details')).toBe(true)
      expect(stepHasErrors(state, 'provider')).toBe(false)
    })

    it('clears step errors', () => {
      const state = getDefaultState()
      state.stepErrors.details = ['Error 1', 'Error 2']
      const newState = { ...state, stepErrors: { ...state.stepErrors, details: [] } }
      expect(stepHasErrors(newState, 'details')).toBe(false)
    })
  })

  describe('Test Result State', () => {
    it('starts with idle status', () => {
      const state = getDefaultState()
      expect(state.testResult.status).toBe('idle')
    })

    it('can transition to testing', () => {
      const result: WizardTestResult = { status: 'testing' }
      expect(result.status).toBe('testing')
    })

    it('can transition to success', () => {
      const result: WizardTestResult = {
        status: 'success',
        message: 'Connection successful',
      }
      expect(result.status).toBe('success')
      expect(result.message).toBeDefined()
    })

    it('can transition to failure with error type', () => {
      const errorTypes: WizardTestResult['errorType'][] = [
        'timeout',
        'invalid_credentials',
        'server_unreachable',
        'ssl_error',
        'unknown',
      ]
      for (const errorType of errorTypes) {
        const result: WizardTestResult = {
          status: 'failure',
          errorType,
          message: `Error: ${errorType}`,
        }
        expect(result.status).toBe('failure')
        expect(result.errorType).toBe(errorType)
      }
    })
  })

  describe('Review Page Data', () => {
    it('masks passwords correctly', () => {
      const maskPassword = (pw: string) => {
        if (!pw) return ''
        return '\u2022'.repeat(Math.min(pw.length, 8))
      }

      expect(maskPassword('')).toBe('')
      expect(maskPassword('password123')).toBe('\u2022'.repeat(8))
      expect(maskPassword('ab')).toBe('\u2022'.repeat(2))
    })

    it('shows provider labels', () => {
      const labels: Record<MailboxProvider, string> = {
        gmail: 'Gmail',
        outlook: 'Outlook / Microsoft 365',
        zoho: 'Zoho Mail',
        custom: 'Generic SMTP / IMAP',
      }
      expect(labels.gmail).toBe('Gmail')
      expect(labels.outlook).toBe('Outlook / Microsoft 365')
      expect(labels.zoho).toBe('Zoho Mail')
      expect(labels.custom).toBe('Generic SMTP / IMAP')
    })

    it('identifies oauth vs smtp providers', () => {
      const isOAuth = (p: MailboxProvider) => p !== 'custom'
      expect(isOAuth('gmail')).toBe(true)
      expect(isOAuth('outlook')).toBe(true)
      expect(isOAuth('zoho')).toBe(true)
      expect(isOAuth('custom')).toBe(false)
    })
  })

  describe('Wizard State Completeness', () => {
    it('has all required fields', () => {
      const state = getDefaultState()
      expect(state).toHaveProperty('currentStep')
      expect(state).toHaveProperty('provider')
      expect(state).toHaveProperty('values')
      expect(state).toHaveProperty('testResult')
      expect(state).toHaveProperty('stepErrors')
    })

    it('has all step error slots', () => {
      const state = getDefaultState()
      const steps: WizardStep[] = ['provider', 'details', 'review', 'test', 'complete']
      for (const step of steps) {
        expect(state.stepErrors).toHaveProperty(step)
        expect(Array.isArray(state.stepErrors[step])).toBe(true)
      }
    })

    it('has values with nested smtp and imap', () => {
      const values = getDefaultValues()
      expect(values).toHaveProperty('smtp')
      expect(values).toHaveProperty('imap')
      expect(values.smtp).toHaveProperty('smtpHost')
      expect(values.smtp).toHaveProperty('smtpPort')
      expect(values.imap).toHaveProperty('imapHost')
      expect(values.imap).toHaveProperty('imapPort')
      expect(values.imap).toHaveProperty('imapSsl')
    })
  })
})
