"use client"

import { useEffect, useMemo, useState } from "react"
import { BookmarkPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type DialerFilters = {
  q: string
  outcome: string
  direction: string
  range: string
  recordingOnly: boolean
}

type SavedPreset = { name: string; filters: DialerFilters }

const KEY = "dialer.savedPresets.v1"

function loadPresets(): SavedPreset[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePresets(presets: SavedPreset[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(presets.slice(0, 12)))
}

export default function FilterPresets({
  current,
  onApply,
}: {
  current: DialerFilters
  onApply: (filters: DialerFilters) => void
}) {
  const [name, setName] = useState("")
  const [presets, setPresets] = useState<SavedPreset[]>([])

  useEffect(() => {
    setPresets(loadPresets())
  }, [])

  const quick = useMemo(
    () => [
      { name: "Today", filters: { ...current, range: "today" } },
      { name: "Connected", filters: { ...current, outcome: "connected" } },
      { name: "Voicemail", filters: { ...current, outcome: "voicemail" } },
      { name: "Recording", filters: { ...current, recordingOnly: true } },
    ],
    [current]
  )

  const addPreset = () => {
    const n = name.trim()
    if (!n) return
    const next = [{ name: n, filters: current }, ...presets.filter((p) => p.name !== n)]
    setPresets(next)
    savePresets(next)
    setName("")
  }

  const removePreset = (n: string) => {
    const next = presets.filter((p) => p.name !== n)
    setPresets(next)
    savePresets(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {quick.map((p) => (
          <Button key={p.name} type="button" size="sm" variant="outline" onClick={() => onApply(p.filters)}>
            {p.name}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Save preset name…"
          className="w-[240px]"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addPreset()
            }
          }}
        />
        <Button type="button" size="sm" onClick={addPreset} disabled={!name.trim()}>
          <BookmarkPlus className="h-4 w-4 mr-2" />
          Save preset
        </Button>
      </div>

      {presets.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((p) => (
            <div key={p.name} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
              <button type="button" className="hover:underline" onClick={() => onApply(p.filters)}>
                {p.name}
              </button>
              <button type="button" className="opacity-70 hover:opacity-100" onClick={() => removePreset(p.name)} title="Remove">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

