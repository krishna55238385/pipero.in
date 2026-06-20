"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Mic, MicOff, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

type TranscriptPanelProps = {
  disabled?: boolean
  value: string
  onChange: (next: string) => void
  compact?: boolean
}

type SpeechRecognitionLike = {
  start: () => void
  stop: () => void
  abort: () => void
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: any) => void) | null
  onerror: ((ev: any) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null
  const w = window as any
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as any
}

export default function TranscriptPanel({
  disabled,
  value,
  onChange,
  compact,
}: TranscriptPanelProps) {
  const SR = useMemo(() => getSpeechRecognition(), [])
  const supported = !!SR
  // Defer browser-capability UI until after mount so the server render and the
  // first client render match (prevents a hydration mismatch on the Start button).
  const [mounted, setMounted] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [status, setStatus] = useState<string>("Ready")
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const lastAppendedRef = useRef<string>("")

  useEffect(() => {
    setMounted(true)
    setStatus(supported ? "Ready" : "Transcription not supported in this browser")
  }, [supported])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [])

  const start = () => {
    if (disabled) return
    if (!SR) return
    if (isListening) return

    const r: SpeechRecognitionLike = new (SR as any)()
    r.continuous = true
    r.interimResults = true
    r.lang = "en-US"

    r.onresult = (event: any) => {
      let interim = ""
      let finalText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const txt = String(res[0]?.transcript ?? "")
        if (res.isFinal) finalText += txt
        else interim += txt
      }

      // Append only new final segments to avoid duplicates.
      const cleanFinal = finalText.trim()
      if (cleanFinal && cleanFinal !== lastAppendedRef.current) {
        lastAppendedRef.current = cleanFinal
        const sep = value.trim().length > 0 ? "\n" : ""
        onChange(`${value}${sep}${cleanFinal}`)
      }

      if (interim.trim()) setStatus("Listening (capturing...)")
    }

    r.onerror = (e: any) => {
      setStatus(`Error: ${String(e?.error ?? "speech_error")}`)
      setIsListening(false)
    }

    r.onend = () => {
      setIsListening(false)
      setStatus(supported ? "Stopped" : "Transcription not supported")
    }

    recognitionRef.current = r
    lastAppendedRef.current = ""
    setIsListening(true)
    setStatus("Listening…")
    try {
      r.start()
    } catch {
      setIsListening(false)
      setStatus("Unable to start transcription")
    }
  }

  const stop = () => {
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }
    setIsListening(false)
    setStatus(supported ? "Stopped" : "Transcription not supported")
  }

  const clean = () => {
    if (disabled) return
    const trimmed = value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n")
    onChange(trimmed)
  }

  return (
    <Card className={compact ? "rounded-2xl" : "rounded-2xl"}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Transcript</CardTitle>
          <div className="flex items-center gap-2">
            {mounted && supported ? (
              isListening ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={stop}
                  disabled={disabled}
                >
                  <MicOff className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={start}
                  disabled={disabled}
                >
                  <Mic className="h-4 w-4 mr-2" />
                  Start
                </Button>
              )
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={clean}
              disabled={disabled || !value.trim()}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Clean
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{status}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            mounted && supported
              ? "Start transcription, or paste a transcript here…"
              : "Paste a transcript here (live transcription not supported)…"
          }
          className={compact ? "min-h-28" : "min-h-44"}
          disabled={disabled}
        />
        {mounted && !supported && (
          <p className="text-xs text-amber-500">
            Live transcription requires a Chrome-based browser (Web Speech API).
          </p>
        )}
      </CardContent>
    </Card>
  )
}

