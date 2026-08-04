import type { WarmupJob, WarmupQueueItem } from '@/types/mail'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'

const queue: WarmupQueueItem[] = []
let processing = false

export function enqueue(job: WarmupJob, priority: number = 0): void {
  const exists = queue.find(q => q.jobId === job.id)
  if (exists) return

  queue.push({
    jobId: job.id,
    configId: job.configId,
    organizationId: job.organizationId,
    scheduledAt: job.scheduledAt,
    priority,
  })

  queue.sort((a, b) => b.priority - a.priority || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
}

export function dequeue(): WarmupQueueItem | undefined {
  return queue.shift()
}

export function peek(): WarmupQueueItem | undefined {
  return queue[0]
}

export function size(): number {
  return queue.length
}

export function clear(): void {
  queue.length = 0
}

export function removeJob(jobId: string): boolean {
  const index = queue.findIndex(q => q.jobId === jobId)
  if (index === -1) return false
  queue.splice(index, 1)
  return true
}

export function getQueueItems(): readonly WarmupQueueItem[] {
  return queue
}

export function isProcessing(): boolean {
  return processing
}

export function setProcessing(value: boolean): void {
  processing = value
}

export async function enqueueRunnableJobs(): Promise<number> {
  const runnableJobs = await warmupJobRepo.findRunnableJobs()
  let enqueued = 0

  for (const job of runnableJobs) {
    const priority = job.status === 'retrying' ? 1 : 0
    enqueue(job, priority)
    enqueued++
  }

  return enqueued
}

export async function processNext(): Promise<WarmupQueueItem | null> {
  const item = dequeue()
  if (!item) return null

  await warmupJobRepo.updateJob(item.jobId, { status: 'queued' })
  return item
}

export function getStats(): {
  queueSize: number
  processing: boolean
  nextItem: WarmupQueueItem | null
} {
  return {
    queueSize: queue.length,
    processing,
    nextItem: queue[0] ?? null,
  }
}
