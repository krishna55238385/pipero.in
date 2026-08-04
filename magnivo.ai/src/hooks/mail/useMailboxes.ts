'use client'

import { useCallback, useState } from 'react'
import type {
  Mailbox,
  MailApiResult,
  CreateMailboxRequest,
  UpdateMailboxRequest,
  OAuthConfigResponse,
  SMTPConfigResponse,
  IMAPConfigResponse,
  CreateOAuthConfigRequest,
  CreateSMTPConfigRequest,
  CreateIMAPConfigRequest,
} from '@/types/mail'
import {
  getMailboxes,
  getMailbox,
  createMailbox,
  updateMailbox,
  deleteMailbox,
  getMailboxWithConfigs,
  getOAuthConfig,
  createOAuthConfig,
  deleteOAuthConfig,
  getSMTPConfig,
  createSMTPConfig,
  deleteSMTPConfig,
  getIMAPConfig,
  createIMAPConfig,
  deleteIMAPConfig,
} from '@/app/actions/mail'

export function useMailboxes() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMailboxes = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getMailboxes()
      setMailboxes(data)
    } catch {
      setError('Failed to load mailboxes')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchMailbox = useCallback(async (id: string): Promise<Mailbox | null> => {
    return getMailbox(id)
  }, [])

  const fetchMailboxWithConfigs = useCallback(async (id: string): Promise<Mailbox | null> => {
    return getMailboxWithConfigs(id)
  }, [])

  const addMailbox = useCallback(async (input: CreateMailboxRequest): Promise<MailApiResult<Mailbox>> => {
    const result = await createMailbox(input)
    if (result.success) {
      setMailboxes((prev) => [result.data, ...prev])
    }
    return result
  }, [])

  const editMailbox = useCallback(async (id: string, input: UpdateMailboxRequest): Promise<MailApiResult<Mailbox>> => {
    const result = await updateMailbox(id, input)
    if (result.success) {
      setMailboxes((prev) => prev.map((m) => (m.id === id ? result.data : m)))
    }
    return result
  }, [])

  const removeMailbox = useCallback(async (id: string): Promise<MailApiResult<boolean>> => {
    const result = await deleteMailbox(id)
    if (result.success) {
      setMailboxes((prev) => prev.filter((m) => m.id !== id))
    }
    return result
  }, [])

  // OAuth config operations
  const fetchOAuthConfig = useCallback(async (mailboxId: string): Promise<OAuthConfigResponse | null> => {
    return getOAuthConfig(mailboxId)
  }, [])

  const addOAuthConfig = useCallback(async (input: CreateOAuthConfigRequest): Promise<MailApiResult<OAuthConfigResponse>> => {
    return createOAuthConfig(input)
  }, [])

  const removeOAuthConfig = useCallback(async (id: string): Promise<MailApiResult<boolean>> => {
    return deleteOAuthConfig(id)
  }, [])

  // SMTP config operations
  const fetchSMTPConfig = useCallback(async (mailboxId: string): Promise<SMTPConfigResponse | null> => {
    return getSMTPConfig(mailboxId)
  }, [])

  const addSMTPConfig = useCallback(async (input: CreateSMTPConfigRequest): Promise<MailApiResult<SMTPConfigResponse>> => {
    return createSMTPConfig(input)
  }, [])

  const removeSMTPConfig = useCallback(async (id: string): Promise<MailApiResult<boolean>> => {
    return deleteSMTPConfig(id)
  }, [])

  // IMAP config operations
  const fetchIMAPConfig = useCallback(async (mailboxId: string): Promise<IMAPConfigResponse | null> => {
    return getIMAPConfig(mailboxId)
  }, [])

  const addIMAPConfig = useCallback(async (input: CreateIMAPConfigRequest): Promise<MailApiResult<IMAPConfigResponse>> => {
    return createIMAPConfig(input)
  }, [])

  const removeIMAPConfig = useCallback(async (id: string): Promise<MailApiResult<boolean>> => {
    return deleteIMAPConfig(id)
  }, [])

  const refresh = useCallback(async () => {
    await fetchMailboxes()
  }, [fetchMailboxes])

  return {
    mailboxes,
    isLoading,
    error,
    fetch: fetchMailboxes,
    fetchMailbox,
    fetchMailboxWithConfigs,
    addMailbox,
    editMailbox,
    removeMailbox,
    fetchOAuthConfig,
    addOAuthConfig,
    removeOAuthConfig,
    fetchSMTPConfig,
    addSMTPConfig,
    removeSMTPConfig,
    fetchIMAPConfig,
    addIMAPConfig,
    removeIMAPConfig,
    refresh,
  }
}
