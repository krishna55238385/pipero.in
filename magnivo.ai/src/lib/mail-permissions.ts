import type { MailUserPermissions, MailPermissionType } from '@/types/mail'

/**
 * Map Magnivo org roles to mail module permissions.
 * - viewer / member: read (+ limited write for member)
 * - manager: manage mailboxes/campaigns/warmup
 * - admin / super_admin: full admin including soft-delete
 */
export function resolveMailPermissions(role: string): MailUserPermissions {
  const normalized = (role || '').toLowerCase()

  if (normalized === 'super_admin' || normalized === 'admin') {
    return { canRead: true, canWrite: true, canManage: true, canAdmin: true }
  }

  if (normalized === 'manager' || normalized === 'owner') {
    return { canRead: true, canWrite: true, canManage: true, canAdmin: false }
  }

  if (normalized === 'member' || normalized === 'editor' || normalized === 'user') {
    return { canRead: true, canWrite: true, canManage: false, canAdmin: false }
  }

  // viewer / readonly / unknown → read-only
  return { canRead: true, canWrite: false, canManage: false, canAdmin: false }
}

export function hasMailPermission(
  permissions: MailUserPermissions,
  action: MailPermissionType
): boolean {
  switch (action) {
    case 'mail.read':
      return permissions.canRead
    case 'mail.write':
      return permissions.canWrite
    case 'mail.manage':
      return permissions.canManage
    case 'mail.admin':
      return permissions.canAdmin
    default:
      return false
  }
}
