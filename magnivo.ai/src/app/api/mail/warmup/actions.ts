'use server'

import { getSessionUser } from '@/lib/auth'
import * as scheduler from '@/services/mail/warmup-scheduler'
import * as worker from '@/services/mail/warmup-worker'
import * as executionService from '@/services/mail/warmup-execution-service'
import * as metricsService from '@/services/mail/warmup-metrics-service'
import * as recoveryService from '@/services/mail/warmup-recovery-service'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'
import * as warmupExecRepo from '@/repositories/mail/warmup-execution-repository'

async function requireMailUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

// ============================================================
// Scheduler Actions
// ============================================================

export async function startWarmupScheduler() {
  await requireMailUser()
  return scheduler.startScheduler()
}

export async function stopWarmupScheduler() {
  await requireMailUser()
  return scheduler.stopScheduler()
}

export async function pauseWarmupScheduler() {
  await requireMailUser()
  return scheduler.pauseScheduler()
}

export async function resumeWarmupScheduler() {
  await requireMailUser()
  return scheduler.resumeScheduler()
}

export async function runWarmupSchedulerOnce() {
  await requireMailUser()
  return scheduler.runSchedulerOnce()
}

export async function getSchedulerHealthAction() {
  await requireMailUser()
  return scheduler.getSchedulerHealth()
}

export async function getSchedulerStatusAction() {
  await requireMailUser()
  return {
    status: scheduler.getSchedulerStatus(),
    running: scheduler.isSchedulerRunning(),
  }
}

// ============================================================
// Worker Actions
// ============================================================

export async function retryExecutionAction(jobId: string) {
  await requireMailUser()
  return worker.processJob(jobId)
}

export async function cancelJobAction(jobId: string) {
  await requireMailUser()
  return worker.cancelJob(jobId)
}

export async function cancelAllPendingJobsAction(configId: string) {
  await requireMailUser()
  return worker.cancelAllPendingJobs(configId)
}

export async function retryFailedJobsAction() {
  await requireMailUser()
  return worker.retryFailedJobs()
}

export async function getWorkerStatsAction() {
  await requireMailUser()
  return worker.getWorkerStats()
}

// ============================================================
// Execution Actions
// ============================================================

export async function listExecutionsAction(
  orgId: string,
  options?: { limit?: number; offset?: number }
) {
  await requireMailUser()
  return warmupExecRepo.findExecutionsByOrg(orgId, options)
}

export async function getExecutionDetailsAction(executionId: string) {
  await requireMailUser()
  return warmupExecRepo.findExecutionById(executionId)
}

export async function cancelExecutionAction(executionId: string) {
  await requireMailUser()
  return executionService.cancelExecution(executionId)
}

export async function retrySingleExecutionAction(executionId: string) {
  await requireMailUser()
  return executionService.retryExecution(executionId)
}

export async function getExecutionsForJobAction(jobId: string) {
  await requireMailUser()
  return executionService.getExecutionsForJob(jobId)
}

export async function getExecutionsForConfigAction(configId: string, limit?: number) {
  await requireMailUser()
  return executionService.getExecutionsForConfig(configId, limit)
}

// ============================================================
// Job Actions
// ============================================================

export async function listJobsAction(orgId: string, status?: string) {
  await requireMailUser()
  return warmupJobRepo.findJobsByOrg(orgId, status as 'pending' | undefined)
}

export async function getJobDetailsAction(jobId: string) {
  await requireMailUser()
  return warmupJobRepo.findJobById(jobId)
}

// ============================================================
// Metrics Actions
// ============================================================

export async function getWarmupMetricsAction(orgId: string) {
  await requireMailUser()
  return metricsService.getMetrics(orgId)
}

export async function getAuditLogAction(orgId: string, options?: { limit?: number; offset?: number; configId?: string }) {
  await requireMailUser()
  return metricsService.getAuditLog(orgId, options)
}

// ============================================================
// Recovery Actions
// ============================================================

export async function triggerRecoveryAction() {
  await requireMailUser()
  return recoveryService.recoverOnRestart()
}

export async function recoverStuckJobsAction(timeoutMinutes?: number) {
  await requireMailUser()
  return recoveryService.recoverStuckJobs(timeoutMinutes)
}
