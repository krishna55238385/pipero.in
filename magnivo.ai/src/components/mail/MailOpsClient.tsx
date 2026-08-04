'use client'

import { useCallback, useEffect, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Activity, Key, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  getSendQueueStatsAction,
  listSendQueueJobsAction,
  retrySendJobAction,
  cancelSendJobAction,
  listApiKeysAction,
  createApiKeyAction,
  revokeApiKeyAction,
  listWebhooksAction,
  createWebhookAction,
  deleteWebhookAction,
  toggleWebhookAction,
  listWebhookLogsAction,
} from '@/app/actions/mail'

type Tab = 'queue' | 'api-keys' | 'webhooks'

export default function MailOpsClient() {
  const [tab, setTab] = useState<Tab>('queue')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [queueStats, setQueueStats] = useState<Awaited<ReturnType<typeof getSendQueueStatsAction>> | null>(null)
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listSendQueueJobsAction>>>([])
  const [jobStatus, setJobStatus] = useState('all')

  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof listApiKeysAction>>>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null)

  const [webhooks, setWebhooks] = useState<Awaited<ReturnType<typeof listWebhooksAction>>>([])
  const [webhookName, setWebhookName] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookLogs, setWebhookLogs] = useState<Awaited<ReturnType<typeof listWebhookLogsAction>>>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [stats, jobList, keys, hooks, logs] = await Promise.all([
        getSendQueueStatsAction(),
        listSendQueueJobsAction(jobStatus),
        listApiKeysAction(),
        listWebhooksAction(),
        listWebhookLogsAction(),
      ])
      setQueueStats(stats)
      setJobs(jobList)
      setApiKeys(keys)
      setWebhooks(hooks)
      setWebhookLogs(logs)
    } catch {
      setError('Failed to load operations data (tables may need migration)')
    } finally {
      setLoading(false)
    }
  }, [jobStatus])

  useEffect(() => {
    void load()
  }, [load])

  async function createKey() {
    if (!newKeyName.trim()) return
    const result = await createApiKeyAction(newKeyName.trim())
    if (!result.success || !result.data) {
      setError('error' in result ? result.error : 'Failed to create API key')
      return
    }
    setCreatedPlaintext(result.data.plaintext)
    setNewKeyName('')
    setMessage('API key created — copy it now; it will not be shown again')
    await load()
  }

  async function createHook() {
    if (!webhookName.trim() || !webhookUrl.trim()) return
    const result = await createWebhookAction({ name: webhookName.trim(), url: webhookUrl.trim() })
    if (!result.success) {
      setError('error' in result ? result.error : 'Failed to create webhook')
      return
    }
    setWebhookName('')
    setWebhookUrl('')
    setMessage('Webhook created')
    await load()
  }

  return (
    <div className="space-y-6">
      <MailPageHeader
        title="Operations"
        description="Send queue, API keys, webhooks, and delivery logs"
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['queue', 'Queue', Activity],
            ['api-keys', 'API keys', Key],
            ['webhooks', 'Webhooks', Link2],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button key={key} size="sm" variant={tab === key ? 'default' : 'outline'} onClick={() => setTab(key)}>
            <Icon className="h-3.5 w-3.5 mr-1" />
            {label}
          </Button>
        ))}
      </div>

      {tab === 'queue' && (
        <div className="space-y-4">
          {queueStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(queueStats).map(([k, v]) => (
                <Card key={k}>
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground capitalize">{k}</p>
                    <p className="text-xl font-bold tabular-nums mt-1">{v}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={jobStatus}
              onChange={(e) => setJobStatus(e.target.value)}
            >
              {['all', 'pending', 'processing', 'deferred', 'failed', 'sent', 'cancelled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <Card>
            <CardContent className="p-0">
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground p-6">No jobs in queue</p>
              ) : (
                <div className="divide-y">
                  {jobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{job.toEmail}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {job.subject || '(no subject)'} · attempt {job.attempts}/{job.maxAttempts}
                          {job.lastError ? ` · ${job.lastError}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{job.status}</Badge>
                        {['failed', 'deferred', 'cancelled'].includes(job.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await retrySendJobAction(job.id)
                              await load()
                            }}
                          >
                            Retry
                          </Button>
                        )}
                        {['pending', 'deferred', 'failed'].includes(job.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await cancelSendJobAction(job.id)
                              await load()
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'api-keys' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create API key</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-2">
              <Input placeholder="Key name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
              <Button onClick={() => void createKey()}>Generate</Button>
            </CardContent>
          </Card>
          {createdPlaintext && (
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground mb-1">Copy now — shown once</p>
                <code className="text-xs break-all">{createdPlaintext}</code>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="p-0">
              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground p-6">No API keys</p>
              ) : (
                <div className="divide-y">
                  {apiKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{k.name}</p>
                        <p className="text-xs text-muted-foreground">{k.keyPrefix}… · {k.scopes.join(', ')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={k.revokedAt ? 'secondary' : 'outline'}>
                          {k.revokedAt ? 'revoked' : 'active'}
                        </Badge>
                        {!k.revokedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await revokeApiKeyAction(k.id)
                              await load()
                            }}
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'webhooks' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add webhook</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-2">
              <Input placeholder="Name" value={webhookName} onChange={(e) => setWebhookName(e.target.value)} />
              <Input placeholder="https://…" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
              <Button onClick={() => void createHook()}>Add</Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {webhooks.length === 0 ? (
                <p className="text-sm text-muted-foreground p-6">No webhooks</p>
              ) : (
                <div className="divide-y">
                  {webhooks.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{w.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{w.url}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={w.isActive ? 'outline' : 'secondary'}>
                          {w.isActive ? 'active' : 'paused'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await toggleWebhookAction(w.id, !w.isActive)
                            await load()
                          }}
                        >
                          {w.isActive ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={async () => {
                            await deleteWebhookAction(w.id)
                            await load()
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook logs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {webhookLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No delivery logs yet</p>
              ) : (
                webhookLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                    <div>
                      <p className="font-medium">{log.eventType}</p>
                      <p className="text-xs text-muted-foreground">
                        {log.success ? 'ok' : 'failed'}
                        {log.statusCode != null ? ` · HTTP ${log.statusCode}` : ''}
                        {log.errorMessage ? ` · ${log.errorMessage}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
