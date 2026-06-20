'use client'

import { Button } from '@/components/ui/button'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

export default function DialPad({
  onPress,
}: {
  onPress: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <Button
          key={k}
          type="button"
          variant="outline"
          className="h-14 rounded-2xl text-lg font-semibold shadow-xs hover:bg-accent/50 hover:scale-[1.01] active:scale-[0.98] transition-transform"
          onClick={() => onPress(k)}
        >
          {k}
        </Button>
      ))}
    </div>
  )
}

