'use client'

import { Button } from '@/components/ui/button'
import { ArrowLeft, ArrowRight, X, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

type WizardFooterProps = {
  canGoBack: boolean
  canGoNext: boolean
  isFirstStep: boolean
  isLastStep: boolean
  isCompleteStep: boolean
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  onSaveDraft?: () => void
  nextLabel?: string
  className?: string
}

export function WizardFooter({
  canGoBack,
  canGoNext,
  isFirstStep,
  isLastStep,
  isCompleteStep,
  onBack,
  onNext,
  onCancel,
  onSaveDraft,
  nextLabel,
  className,
}: WizardFooterProps) {
  if (isCompleteStep) return null

  return (
    <div
      className={cn(
        'flex items-center justify-between pt-6 border-t border-border/40',
        className
      )}
    >
      <div className="flex items-center gap-2">
        {!isFirstStep && (
          <Button
            variant="outline"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Go to previous step"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Back
          </Button>
        )}
        {onSaveDraft && (
          <Button
            variant="ghost"
            onClick={onSaveDraft}
            className="text-muted-foreground"
            aria-label="Save draft"
          >
            <Save className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Save Draft
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="text-muted-foreground"
          aria-label="Cancel and exit wizard"
        >
          <X className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Cancel
        </Button>
        {!isLastStep && (
          <Button
            onClick={onNext}
            disabled={!canGoNext}
            aria-label="Go to next step"
          >
            {nextLabel || 'Next'}
            <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}
