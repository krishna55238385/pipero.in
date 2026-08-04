'use client'

import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'
import type { MailboxProvider, WizardTestResult, WizardSMTPValues, WizardIMAPValues } from '@/types/mail'
import { testMailboxConnection } from '@/app/actions/mail'

type WizardTestStepProps = {
  provider: MailboxProvider
  email: string
  smtp: WizardSMTPValues
  imap: WizardIMAPValues
  testResult: WizardTestResult
  onTestStart: () => void
  onTestResult: (result: WizardTestResult) => void
  onNext: () => void
}

export function WizardTestStep({
  provider,
  email,
  smtp,
  imap,
  testResult,
  onTestStart,
  onTestResult,
  onNext,
}: WizardTestStepProps) {
  const runTest = useCallback(async () => {
    onTestStart()
    try {
      const result = await testMailboxConnection({ provider, email, smtp, imap })
      onTestResult(result)
    } catch {
      onTestResult({
        status: 'failure',
        errorType: 'unknown',
        message: 'An unexpected error occurred while testing the connection.',
      })
    }
  }, [provider, email, smtp, imap, onTestStart, onTestResult])

  useEffect(() => {
    if (testResult.status === 'idle') {
      runTest()
    }
  }, [testResult.status, runTest])

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Test Connection</h2>
        <p className="text-sm text-muted-foreground">
          Verify that your mailbox can connect successfully.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {testResult.status === 'testing' && (
          <motion.div
            key="testing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <Card>
              <CardContent className="pt-8 pb-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                  >
                    <Loader2 className="h-12 w-12 text-primary" />
                  </motion.div>
                  <div>
                    <h3 className="font-medium text-foreground">Testing Connection...</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Verifying {provider !== 'custom' ? 'OAuth' : 'SMTP/IMAP'} settings for {provider}...
                    </p>
                  </div>
                  <div className="w-full max-w-xs">
                    <motion.div
                      className="h-1.5 bg-muted rounded-full overflow-hidden"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: '90%' }}
                        transition={{ duration: 3, ease: 'easeOut' }}
                      />
                    </motion.div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {testResult.status === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="border-emerald-500/20 bg-emerald-500/5">
              <CardContent className="pt-8 pb-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                  </motion.div>
                  <div>
                    <h3 className="font-medium text-foreground">
                      {testResult.status === 'success' ? 'Connection Successful' : 'Connection Failed'}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {testResult.message}
                    </p>
                    {testResult.steps && testResult.steps.length > 0 && (
                      <ul className="mt-3 space-y-1.5 text-left text-sm">
                        {testResult.steps.map((step) => (
                          <li key={step.name} className="flex items-start gap-2">
                            {step.passed ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            ) : (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            )}
                            <span>
                              <span className="font-medium">{step.name}</span>
                              {step.detail ? (
                                <span className="block text-xs text-muted-foreground">{step.detail}</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Button onClick={onNext} className="mt-2">
                    Complete Setup
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {testResult.status === 'failure' && (
          <motion.div
            key="failure"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="border-destructive/20 bg-destructive/5">
              <CardContent className="pt-8 pb-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <XCircle className="h-12 w-12 text-destructive" />
                  </motion.div>
                  <div>
                    <h3 className="font-medium text-foreground">Connection Failed</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {testResult.message}
                    </p>
                    {testResult.steps && testResult.steps.length > 0 && (
                      <ul className="mt-3 space-y-1.5 text-left text-sm">
                        {testResult.steps.map((step) => (
                          <li key={step.name} className="flex items-start gap-2">
                            {step.passed ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            ) : (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            )}
                            <span>
                              <span className="font-medium">{step.name}</span>
                              {step.detail ? (
                                <span className="block text-xs text-muted-foreground">{step.detail}</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <Button variant="outline" onClick={runTest}>
                      <RotateCcw className="h-4 w-4 mr-1.5" aria-hidden="true" />
                      Retry
                    </Button>
                    <Button variant="destructive" onClick={onNext}>
                      Continue Anyway
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
