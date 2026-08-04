'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { AUTOSAVE_DEBOUNCE_MS, VALIDATION_POLL_MS } from '@/lib/campaign-builder/constants'

export function useCampaignAutosave(campaignId: string) {
  const save = useCampaignBuilderStore((s) => s.save)
  const refreshValidation = useCampaignBuilderStore((s) => s.refreshValidation)
  const isDirty = useCampaignBuilderStore((s) => s.isDirty)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const validationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    validationTimerRef.current = setInterval(() => {
      refreshValidation()
    }, VALIDATION_POLL_MS)
    return () => {
      if (validationTimerRef.current) clearInterval(validationTimerRef.current)
    }
  }, [refreshValidation])

  useEffect(() => {
    if (!isDirty) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      save()
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [isDirty, save])

  return { campaignId }
}

export function useCampaignDragAndDrop() {
  const addNode = useCampaignBuilderStore((s) => s.addNode)

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const nodeType = e.dataTransfer.getData('application/campaignnode')
      if (!nodeType) return
      addNode(nodeType as Parameters<typeof addNode>[0])
    },
    [addNode],
  )

  return { onDragOver, onDrop }
}
