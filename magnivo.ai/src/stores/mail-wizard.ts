'use client'

import { create } from 'zustand'
import type {
  WizardStep,
  WizardState,
  WizardValues,
  WizardTestResult,
  WizardTestStatus,
  MailboxProvider as MailboxProviderType,
  SMTPEncryption,
  SMTPAuthenticationType,
} from '@/types/mail'

const WIZARD_STEPS: WizardStep[] = ['provider', 'details', 'review', 'test', 'complete']

const defaultSMTPValues = {
  smtpHost: '',
  smtpPort: '587',
  smtpUsername: '',
  smtpPassword: '',
  encryption: 'starttls' as SMTPEncryption,
  authenticationType: 'password' as SMTPAuthenticationType,
}

const defaultIMAPValues = {
  imapHost: '',
  imapPort: '993',
  imapUsername: '',
  imapPassword: '',
  imapSsl: true,
}

const defaultValues: WizardValues = {
  email: '',
  displayName: '',
  senderName: '',
  timezone: 'UTC',
  dailyLimit: 50,
  smtp: defaultSMTPValues,
  imap: defaultIMAPValues,
}

const defaultTestResult: WizardTestResult = {
  status: 'idle',
}

const defaultStepErrors: Record<WizardStep, string[]> = {
  provider: [],
  details: [],
  review: [],
  test: [],
  complete: [],
}

function getDefaultValuesForProvider(provider: MailboxProviderType): WizardValues {
  const base = { ...defaultValues }
  if (provider === 'gmail') {
    base.smtp.smtpHost = 'smtp.gmail.com'
    base.smtp.smtpPort = '587'
    base.smtp.encryption = 'starttls'
    base.imap.imapHost = 'imap.gmail.com'
    base.imap.imapPort = '993'
    base.imap.imapSsl = true
  } else if (provider === 'outlook') {
    base.smtp.smtpHost = 'smtp.office365.com'
    base.smtp.smtpPort = '587'
    base.smtp.encryption = 'starttls'
    base.imap.imapHost = 'outlook.office365.com'
    base.imap.imapPort = '993'
    base.imap.imapSsl = true
  } else if (provider === 'zoho') {
    base.smtp.smtpHost = 'smtp.zoho.com'
    base.smtp.smtpPort = '587'
    base.smtp.encryption = 'starttls'
    base.imap.imapHost = 'imap.zoho.com'
    base.imap.imapPort = '993'
    base.imap.imapSsl = true
  }
  return base
}

type MailWizardStore = WizardState & {
  setStep: (step: WizardStep) => void
  nextStep: () => void
  prevStep: () => void
  setProvider: (provider: MailboxProviderType) => void
  setValues: (values: Partial<WizardValues>) => void
  setSMTPValues: (values: Partial<WizardValues['smtp']>) => void
  setIMAPValues: (values: Partial<WizardValues['imap']>) => void
  setTestResult: (result: WizardTestResult) => void
  setTestStatus: (status: WizardTestStatus) => void
  setStepErrors: (step: WizardStep, errors: string[]) => void
  canGoNext: () => boolean
  canGoBack: () => boolean
  resetWizard: () => void
}

const initialState: WizardState = {
  currentStep: 'provider',
  provider: null,
  values: { ...defaultValues },
  testResult: { ...defaultTestResult },
  stepErrors: { ...defaultStepErrors },
}

export const useMailWizardStore = create<MailWizardStore>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),

  nextStep: () => {
    const { currentStep } = get()
    const idx = WIZARD_STEPS.indexOf(currentStep)
    if (idx < WIZARD_STEPS.length - 1) {
      set({ currentStep: WIZARD_STEPS[idx + 1] })
    }
  },

  prevStep: () => {
    const { currentStep } = get()
    const idx = WIZARD_STEPS.indexOf(currentStep)
    if (idx > 0) {
      set({ currentStep: WIZARD_STEPS[idx - 1] })
    }
  },

  setProvider: (provider) => {
    set({
      provider,
      values: getDefaultValuesForProvider(provider),
      stepErrors: { ...defaultStepErrors },
    })
  },

  setValues: (values) =>
    set((state) => ({
      values: { ...state.values, ...values },
    })),

  setSMTPValues: (smtpValues) =>
    set((state) => ({
      values: {
        ...state.values,
        smtp: { ...state.values.smtp, ...smtpValues },
      },
    })),

  setIMAPValues: (imapValues) =>
    set((state) => ({
      values: {
        ...state.values,
        imap: { ...state.values.imap, ...imapValues },
      },
    })),

  setTestResult: (result) => set({ testResult: result }),

  setTestStatus: (status) =>
    set((state) => ({
      testResult: { ...state.testResult, status },
    })),

  setStepErrors: (step, errors) =>
    set((state) => ({
      stepErrors: { ...state.stepErrors, [step]: errors },
    })),

  canGoNext: () => {
    const { currentStep, provider } = get()
    if (currentStep === 'provider') return provider !== null
    return true
  },

  canGoBack: () => {
    const { currentStep } = get()
    return currentStep !== 'provider' && currentStep !== 'complete'
  },

  resetWizard: () => set({ ...initialState }),
}))
