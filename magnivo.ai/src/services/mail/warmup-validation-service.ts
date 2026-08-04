import { WarmupConfigModel, WarmupConfigStatus } from '@/types/mail';
import * as warmupRepo from '@/repositories/mail/warmup-repository';
import * as mailboxRepo from '@/repositories/mail/mailbox-repository';

export async function validateCanStartWarmup(orgId: string, mailboxId: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[][] = [];

  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId);
  if (!mailbox) {
    errors.push(['Mailbox not found']);
  } else if (!['connected', 'warming'].includes(mailbox.mailboxStatus)) {
    errors.push([`Mailbox status "${mailbox.mailboxStatus}" does not allow warmup. Must be "connected" or "warming"`]);
  }

  const activeConfig = await warmupRepo.findActiveConfigByMailboxId(mailboxId, orgId);
  if (activeConfig) {
    errors.push([`Active warmup config already exists for this mailbox (status: ${activeConfig.status})`]);
  }

  return {
    valid: errors.length === 0,
    errors: errors.flat(),
  };
}

export function validateCanPauseWarmup(config: WarmupConfigModel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!['running', 'pending'].includes(config.status)) {
    errors.push(`Cannot pause warmup with status "${config.status}". Must be "running" or "pending"`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCanResumeWarmup(config: WarmupConfigModel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.status !== 'paused') {
    errors.push(`Cannot resume warmup with status "${config.status}". Must be "paused"`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCanRestartWarmup(config: WarmupConfigModel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const canRestart = ['completed', 'failed', 'graduated'].includes(config.status) ||
    (config.status === 'paused' && config.currentDay >= config.totalDays);

  if (!canRestart) {
    errors.push(`Cannot restart warmup with status "${config.status}". Must be "completed", "failed", "graduated", or "paused" with completed days`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCanGraduateWarmup(
  config: WarmupConfigModel,
  opts?: { force?: boolean }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!['running', 'paused'].includes(config.status)) {
    errors.push(`Cannot graduate warmup with status "${config.status}". Must be "running" or "paused"`);
  }

  // Manual admin override may bypass ramp/health gates (with UI confirmation)
  if (opts?.force) {
    return { valid: errors.length === 0, errors }
  }

  // PRD §14 6.3: BOTH health threshold AND minimum ramp duration required for auto-graduation
  const minDays = Math.max(1, Math.floor(config.totalDays * 0.7))
  const daysCompleted = config.currentDay >= minDays
  const score = (config as { healthScore?: number }).healthScore
  const threshold = config.graduationThreshold ?? config.targetHealthScore ?? 70

  if (typeof score === 'number') {
    if (score < threshold) {
      errors.push(`Health score ${score} is below graduation threshold ${threshold}`)
    }
  } else if (config.health === 'critical' || config.health === 'warning') {
    errors.push('Health score has not met the graduation threshold')
  }

  if (!daysCompleted) {
    errors.push(`Minimum ramp duration not met (day ${config.currentDay} of ${config.totalDays}; need ≥ ${minDays})`)
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCanUpdateWarmup(config: WarmupConfigModel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!['draft', 'pending'].includes(config.status)) {
    errors.push(`Cannot update warmup config with status "${config.status}". Must be "draft" or "pending"`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCanDeleteWarmup(config: WarmupConfigModel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const deletableStatuses: WarmupConfigStatus[] = ['draft', 'pending', 'completed', 'graduated', 'failed', 'disabled'];

  if (!deletableStatuses.includes(config.status)) {
    errors.push(`Cannot delete warmup with status "${config.status}". Must not be "running" or "paused"`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateCanBulkOperation(configs: WarmupConfigModel[], operation: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (configs.length === 0) {
    errors.push('No configurations provided');
    return { valid: false, errors };
  }

  switch (operation) {
    case 'pause': {
      const nonPausable = configs.filter(c => !['running', 'pending'].includes(c.status));
      if (nonPausable.length > 0) {
        errors.push(`${nonPausable.length} config(s) cannot be paused (statuses: ${nonPausable.map(c => c.status).join(', ')})`);
      }
      break;
    }
    case 'resume': {
      const nonResumable = configs.filter(c => c.status !== 'paused');
      if (nonResumable.length > 0) {
        errors.push(`${nonResumable.length} config(s) cannot be resumed (statuses: ${nonResumable.map(c => c.status).join(', ')})`);
      }
      break;
    }
    case 'archive':
    case 'delete': {
      const active = configs.filter(c => ['running', 'paused'].includes(c.status));
      if (active.length > 0) {
        errors.push(`${active.length} config(s) are active and cannot be ${operation === 'archive' ? 'archived' : 'deleted'} (statuses: ${active.map(c => c.status).join(', ')})`);
      }
      break;
    }
    default:
      errors.push(`Unknown operation "${operation}"`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
