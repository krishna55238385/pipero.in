'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Flame, Globe, LayoutDashboard, Plus, LifeBuoy } from 'lucide-react'
import type { WizardTestStatus, MailApiResult, Mailbox } from '@/types/mail'

type WizardCompleteStepProps = {
  testStatus: WizardTestStatus
  createResult?: MailApiResult<Mailbox> | null
  onAddAnother: () => void
  onGoToDashboard: () => void
}

export function WizardCompleteStep({
  testStatus,
  createResult,
  onAddAnother,
  onGoToDashboard,
}: WizardCompleteStepProps) {
  const isSuccess = testStatus === 'success' && createResult?.success !== false
  const createError = createResult && !createResult.success ? createResult.error : null

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <AnimatePresence>
        <motion.div
          key="complete"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <Card className={isSuccess ? 'border-emerald-500/20' : 'border-amber-500/20'}>
            <CardContent className="pt-10 pb-10">
              <div className="flex flex-col items-center text-center space-y-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                  className={isSuccess ? 'text-emerald-600' : 'text-amber-600'}
                >
                  {isSuccess ? (
                    <CheckCircle2 className="h-16 w-16" />
                  ) : (
                    <XCircle className="h-16 w-16" />
                  )}
                </motion.div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-foreground">
                    {isSuccess ? 'Mailbox Added Successfully' : 'Mailbox Added with Errors'}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {isSuccess
                      ? 'Your mailbox is connected and ready. Complete the steps below to maximize deliverability.'
                      : 'Your mailbox was added but the connection test failed. You can retry the test or configure settings manually.'}
                  </p>
                  {createError && (
                    <p className="text-sm text-destructive mt-2">
                      {createError}
                    </p>
                  )}
                </div>

                <div className="w-full space-y-3 pt-2">
                  <h3 className="text-sm font-medium text-foreground">Next Steps</h3>
                  <div className="grid grid-cols-1 gap-3 w-full">
                    <a href="/mail/deliverability" className="block">
                      <StepCard
                        icon={<Globe className="h-4 w-4" />}
                        title="Configure DNS Records"
                        description="Set up SPF, DKIM, and DMARC for your domain"
                        delay={0.15}
                      />
                    </a>
                    <a href="/mail/warmup" className="block">
                      <StepCard
                        icon={<Flame className="h-4 w-4" />}
                        title="Start Warmup"
                        description="Build sender reputation with gradual sending"
                        delay={0.2}
                      />
                    </a>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 w-full">
                  <Button onClick={onAddAnother} variant="outline" className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    Add Another Mailbox
                  </Button>
                  <Button onClick={onGoToDashboard} className="w-full sm:w-auto">
                    <LayoutDashboard className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    Return to Dashboard
                  </Button>
                </div>

                <div className="pt-2">
                  <Button variant="ghost" size="sm" className="text-muted-foreground text-xs">
                    <LifeBuoy className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    Need help? Contact Support
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function StepCard({
  icon,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode
  title: string
  description: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 text-left">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </motion.div>
  )
}
