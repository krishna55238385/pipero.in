'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import type { WizardStep } from '@/types/mail'
import { cn } from '@/lib/utils'

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'details', label: 'Details' },
  { key: 'review', label: 'Review' },
  { key: 'test', label: 'Test' },
  { key: 'complete', label: 'Done' },
]

type WizardStepperProps = {
  currentStep: WizardStep
  className?: string
}

export function WizardStepper({ currentStep, className }: WizardStepperProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep)

  return (
    <nav aria-label="Progress" className={cn('flex items-center justify-center', className)}>
      <ol className="flex items-center gap-0" role="list">
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex
          const isCurrent = index === currentIndex
          const isUpcoming = index > currentIndex

          return (
            <li key={step.key} className="flex items-center" role="listitem">
              <div className="flex items-center gap-2">
                <motion.div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
                    isCompleted && 'bg-primary text-primary-foreground',
                    isCurrent && 'bg-primary text-primary-foreground ring-2 ring-primary/20 ring-offset-2 ring-offset-background',
                    isUpcoming && 'bg-muted text-muted-foreground'
                  )}
                  animate={isCurrent ? { scale: [1, 1.05, 1] } : {}}
                  transition={{ duration: 0.3 }}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </motion.div>
                <span
                  className={cn(
                    'text-sm font-medium hidden sm:inline',
                    isCurrent && 'text-foreground',
                    isCompleted && 'text-foreground',
                    isUpcoming && 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-2 h-px w-6 sm:w-10',
                    isCompleted ? 'bg-primary' : 'bg-border'
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
