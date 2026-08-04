import * as warmupQueue from '@/services/mail/warmup-queue'
import type { WarmupJob } from '@/types/mail'
import { makeJob } from './warmup-execution-engine-test-helpers'

describe('warmup-queue', () => {
  beforeEach(() => {
    warmupQueue.clear()
    warmupQueue.setProcessing(false)
  })

  describe('enqueue', () => {
    it('adds a job to the queue', () => {
      const job = makeJob()
      warmupQueue.enqueue(job)
      expect(warmupQueue.size()).toBe(1)
    })

    it('does not add duplicate jobs', () => {
      const job = makeJob()
      warmupQueue.enqueue(job)
      warmupQueue.enqueue(job)
      expect(warmupQueue.size()).toBe(1)
    })

    it('sorts by priority then scheduled time', () => {
      const job1 = makeJob({ id: 'job-1', scheduledAt: '2026-07-22T12:00:00Z' })
      const job2 = makeJob({ id: 'job-2', scheduledAt: '2026-07-22T11:00:00Z' })

      warmupQueue.enqueue(job1, 0)
      warmupQueue.enqueue(job2, 1)

      const items = warmupQueue.getQueueItems()
      expect(items[0].jobId).toBe('job-2')
    })

    it('sorts by scheduled time when priorities are equal', () => {
      const job1 = makeJob({ id: 'job-1', scheduledAt: '2026-07-22T12:00:00Z' })
      const job2 = makeJob({ id: 'job-2', scheduledAt: '2026-07-22T11:00:00Z' })

      warmupQueue.enqueue(job1, 0)
      warmupQueue.enqueue(job2, 0)

      const items = warmupQueue.getQueueItems()
      expect(items[0].jobId).toBe('job-2')
    })
  })

  describe('dequeue', () => {
    it('returns undefined when queue is empty', () => {
      expect(warmupQueue.dequeue()).toBeUndefined()
    })

    it('returns and removes the first item', () => {
      const job = makeJob()
      warmupQueue.enqueue(job)

      const item = warmupQueue.dequeue()
      expect(item).toBeDefined()
      expect(item?.jobId).toBe(job.id)
      expect(warmupQueue.size()).toBe(0)
    })
  })

  describe('peek', () => {
    it('returns undefined when queue is empty', () => {
      expect(warmupQueue.peek()).toBeUndefined()
    })

    it('returns first item without removing', () => {
      const job = makeJob()
      warmupQueue.enqueue(job)

      const item = warmupQueue.peek()
      expect(item).toBeDefined()
      expect(warmupQueue.size()).toBe(1)
    })
  })

  describe('removeJob', () => {
    it('removes a specific job', () => {
      const job1 = makeJob({ id: 'job-1' })
      const job2 = makeJob({ id: 'job-2' })
      warmupQueue.enqueue(job1)
      warmupQueue.enqueue(job2)

      const removed = warmupQueue.removeJob('job-1')
      expect(removed).toBe(true)
      expect(warmupQueue.size()).toBe(1)
    })

    it('returns false for non-existent job', () => {
      expect(warmupQueue.removeJob('nonexistent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('empties the queue', () => {
      warmupQueue.enqueue(makeJob({ id: 'job-1' }))
      warmupQueue.enqueue(makeJob({ id: 'job-2' }))
      warmupQueue.clear()
      expect(warmupQueue.size()).toBe(0)
    })
  })

  describe('getStats', () => {
    it('returns queue stats', () => {
      warmupQueue.enqueue(makeJob())
      const stats = warmupQueue.getStats()
      expect(stats.queueSize).toBe(1)
      expect(stats.processing).toBe(false)
      expect(stats.nextItem).toBeDefined()
    })
  })

  describe('isProcessing / setProcessing', () => {
    it('tracks processing state', () => {
      expect(warmupQueue.isProcessing()).toBe(false)
      warmupQueue.setProcessing(true)
      expect(warmupQueue.isProcessing()).toBe(true)
    })
  })
})
