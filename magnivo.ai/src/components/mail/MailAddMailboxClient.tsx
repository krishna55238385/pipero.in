'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { WizardStepper } from '@/components/mail/wizard/WizardStepper'
import { WizardFooter } from '@/components/mail/wizard/WizardFooter'
import { WizardProviderStep } from '@/components/mail/wizard/WizardProviderStep'
import { WizardConnectionStep } from '@/components/mail/wizard/WizardConnectionStep'
import { WizardReviewStep } from '@/components/mail/wizard/WizardReviewStep'
import { WizardTestStep } from '@/components/mail/wizard/WizardTestStep'
import { WizardCompleteStep } from '@/components/mail/wizard/WizardCompleteStep'
import { useMailWizardStore } from '@/stores/mail-wizard'
import { createMailboxWithConnection } from '@/app/actions/mail'
import type { WizardTestResult, MailApiResult, Mailbox } from '@/types/mail'

const STEP_ANIMATION = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.2, ease: 'easeInOut' as const },
}

export default function MailAddMailboxClient() {
  const router = useRouter()
  const currentStep = useMailWizardStore(s => s.currentStep)
  const provider = useMailWizardStore(s => s.provider)
  const values = useMailWizardStore(s => s.values)
  const stepErrors = useMailWizardStore(s => s.stepErrors)
  const testResult = useMailWizardStore(s => s.testResult)
  const canGoNextFn = useMailWizardStore(s => s.canGoNext)
  const canGoBackFn = useMailWizardStore(s => s.canGoBack)
  const setStep = useMailWizardStore(s => s.setStep)
  const nextStep = useMailWizardStore(s => s.nextStep)
  const prevStep = useMailWizardStore(s => s.prevStep)
  const setProvider = useMailWizardStore(s => s.setProvider)
  const setValues = useMailWizardStore(s => s.setValues)
  const setSMTPValues = useMailWizardStore(s => s.setSMTPValues)
  const setIMAPValues = useMailWizardStore(s => s.setIMAPValues)
  const setTestResult = useMailWizardStore(s => s.setTestResult)
  const setTestStatus = useMailWizardStore(s => s.setTestStatus)
  const setStepErrors = useMailWizardStore(s => s.setStepErrors)
  const resetWizard = useMailWizardStore(s => s.resetWizard)
  const [isCreating, setIsCreating] = useState(false)
  const [createResult, setCreateResult] = useState<MailApiResult<Mailbox> | null>(null)
  const createAttemptedRef = useRef(false)

  const isFirstStep = currentStep === 'provider'
  const isCompleteStep = currentStep === 'complete'
  const isLastStep = currentStep === 'test'

  const handleNext = useCallback(async () => {
    const cur = useMailWizardStore.getState().currentStep
    const prov = useMailWizardStore.getState().provider
    const vals = useMailWizardStore.getState().values
    if (cur === 'test' && !createAttemptedRef.current) {
      createAttemptedRef.current = true
      setIsCreating(true)
      try {
        const isOAuth = prov !== 'custom'
        const result = await createMailboxWithConnection({
          email: vals.email,
          displayName: vals.displayName,
          senderName: vals.senderName,
          provider: prov!,
          authType: isOAuth ? 'oauth' : 'smtp',
          timezone: vals.timezone,
          dailyLimit: vals.dailyLimit,
          smtp: !isOAuth ? vals.smtp : null,
          imap: !isOAuth ? vals.imap : null,
        })
        setCreateResult(result)
      } catch {
        setCreateResult({ success: false, error: 'Failed to create mailbox. Please try again.' })
      } finally {
        setIsCreating(false)
        useMailWizardStore.getState().nextStep()
      }
      return
    }
    useMailWizardStore.getState().nextStep()
  }, [])

  const handleBack = useCallback(() => {
    prevStep()
  }, [prevStep])

  const handleCancel = useCallback(() => {
    resetWizard()
    router.push('/mail/mailboxes')
  }, [resetWizard, router])

  const handleProviderSelect = useCallback(
    (p: Parameters<typeof setProvider>[0]) => {
      setProvider(p)
    },
    [setProvider]
  )

  const handleValuesChange = useCallback(
    (v: Parameters<typeof setValues>[0]) => {
      setValues(v)
    },
    [setValues]
  )

  const handleSMTPChange = useCallback(
    (v: Parameters<typeof setSMTPValues>[0]) => {
      setSMTPValues(v)
    },
    [setSMTPValues]
  )

  const handleIMAPChange = useCallback(
    (v: Parameters<typeof setIMAPValues>[0]) => {
      setIMAPValues(v)
    },
    [setIMAPValues]
  )

  const handleValidation = useCallback(
    (errors: string[]) => {
      setStepErrors(useMailWizardStore.getState().currentStep, errors)
    },
    [setStepErrors]
  )

  const handleTestStart = useCallback(() => {
    setTestStatus('testing')
  }, [setTestStatus])

  const handleTestResult = useCallback(
    (result: WizardTestResult) => {
      setTestResult(result)
    },
    [setTestResult]
  )

  const handleEditStep = useCallback(
    (step: 'provider' | 'details') => {
      createAttemptedRef.current = false
      setCreateResult(null)
      setStep(step)
    },
    [setStep]
  )

  const handleAddAnother = useCallback(() => {
    createAttemptedRef.current = false
    setCreateResult(null)
    resetWizard()
  }, [resetWizard])

  const handleGoToDashboard = useCallback(() => {
    resetWizard()
    router.push('/mail/mailboxes')
  }, [resetWizard, router])

  const canGoNext = canGoNextFn()
  const hasStepErrors = stepErrors[currentStep]?.length > 0

  return (
    <div className="space-y-6">
      <MailPageHeader
        title="Add Mailbox"
        description="Connect a new email account to your workspace"
      />

      <WizardStepper currentStep={currentStep} />

      <div className="min-h-[400px]">
        <AnimatePresence mode="wait">
          {currentStep === 'provider' && (
            <motion.div key="provider" {...STEP_ANIMATION}>
              <WizardProviderStep
                selectedProvider={provider}
                onSelectProvider={handleProviderSelect}
              />
            </motion.div>
          )}

          {currentStep === 'details' && provider && (
            <motion.div key="details" {...STEP_ANIMATION}>
              <WizardConnectionStep
                provider={provider}
                values={values}
                onValuesChange={handleValuesChange}
                onSMTPChange={handleSMTPChange}
                onIMAPChange={handleIMAPChange}
                onValidation={handleValidation}
              />
            </motion.div>
          )}

          {currentStep === 'review' && provider && (
            <motion.div key="review" {...STEP_ANIMATION}>
              <WizardReviewStep
                provider={provider}
                values={values}
                onEditStep={handleEditStep}
              />
            </motion.div>
          )}

          {currentStep === 'test' && provider && (
            <motion.div key="test" {...STEP_ANIMATION}>
              <WizardTestStep
                provider={provider}
                email={values.email}
                smtp={values.smtp}
                imap={values.imap}
                testResult={testResult}
                onTestStart={handleTestStart}
                onTestResult={handleTestResult}
                onNext={handleNext}
              />
            </motion.div>
          )}

          {currentStep === 'complete' && (
            <motion.div key="complete" {...STEP_ANIMATION}>
              <WizardCompleteStep
                testStatus={testResult.status}
                createResult={createResult}
                onAddAnother={handleAddAnother}
                onGoToDashboard={handleGoToDashboard}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <WizardFooter
        canGoBack={canGoBackFn()}
        canGoNext={canGoNext && !hasStepErrors && !isCreating}
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        isCompleteStep={isCompleteStep}
        onBack={handleBack}
        onNext={handleNext}
        onCancel={handleCancel}
        nextLabel={
          isCreating
            ? 'Creating Mailbox...'
            : currentStep === 'review'
              ? 'Test Connection'
              : undefined
        }
      />
    </div>
  )
}
