import { connect as tlsConnect, type TLSSocket } from 'tls'
import { connect as netConnect } from 'net'
import { classifyError, type MailError } from './errors'

export type IMAPTestInput = {
  host: string
  port: number
  ssl: boolean
  username: string
  password: string
}

export type IMAPTestResult = {
  success: boolean
  error?: MailError
}

const IMAP_TIMEOUT = 10000

function imapCommand(socket: TLSSocket, tag: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('IMAP command timed out'))
    }, IMAP_TIMEOUT)

    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.includes(`${tag} OK`) || buffer.includes(`${tag} NO`) || buffer.includes(`${tag} BAD`)) {
        clearTimeout(timer)
        socket.removeListener('data', onData)
        socket.removeListener('error', onError)
        resolve(buffer)
      }
    }
    const onError = (err: Error) => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      reject(err)
    }

    socket.on('data', onData)
    socket.on('error', onError)
    socket.write(`${tag} ${command}\r\n`)
  })
}

export async function testIMAPConnection(input: IMAPTestInput): Promise<IMAPTestResult> {
  const port = input.port || (input.ssl ? 993 : 143)

  return new Promise<IMAPTestResult>((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ success: false, error: classifyError(new Error('Connection timed out'), 'imap') })
    }, IMAP_TIMEOUT)

    const onError = (err: Error) => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ success: false, error: classifyError(err, 'imap') })
    }

    let socket: TLSSocket

    const onConnect = () => {
      imapCommand(socket, 'A001', `LOGIN "${input.username}" "${input.password}"`)
        .then((response) => {
          clearTimeout(timer)
          if (response.includes('A001 OK')) {
            imapCommand(socket, 'A002', 'LOGOUT')
              .catch(() => {})
              .finally(() => {
                socket.destroy()
                resolve({ success: true })
              })
          } else {
            socket.destroy()
            resolve({
              success: false,
              error: classifyError(new Error('Authentication failed: invalid credentials'), 'imap'),
            })
          }
        })
        .catch((err) => {
          clearTimeout(timer)
          socket.destroy()
          resolve({ success: false, error: classifyError(err, 'imap') })
        })
    }

    if (input.ssl) {
      const rawSocket = netConnect({ host: input.host, port, timeout: IMAP_TIMEOUT })
      rawSocket.on('error', onError)
      socket = tlsConnect({
        socket: rawSocket,
        rejectUnauthorized: true,
        servername: input.host,
      })
      socket.on('error', onError)
      socket.on('connect', onConnect)
    } else {
      const plainSocket = netConnect({ host: input.host, port, timeout: IMAP_TIMEOUT })
      plainSocket.on('error', onError)
      plainSocket.on('connect', () => {
        socket = plainSocket as unknown as TLSSocket
        onConnect()
      })
    }
  })
}

/**
 * Verifies the account can SELECT INBOX (read access), required by PRD §6.1.
 */
export async function verifyInboxReadAccess(input: IMAPTestInput): Promise<IMAPTestResult> {
  const port = input.port || (input.ssl ? 993 : 143)

  return new Promise<IMAPTestResult>((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ success: false, error: classifyError(new Error('Inbox read timed out'), 'imap') })
    }, IMAP_TIMEOUT)

    const onError = (err: Error) => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ success: false, error: classifyError(err, 'imap') })
    }

    let socket: TLSSocket

    const run = async () => {
      try {
        const login = await imapCommand(socket, 'A001', `LOGIN "${input.username}" "${input.password}"`)
        if (!login.includes('A001 OK')) {
          clearTimeout(timer)
          socket.destroy()
          resolve({
            success: false,
            error: classifyError(new Error('Authentication failed: invalid credentials'), 'imap'),
          })
          return
        }
        const select = await imapCommand(socket, 'A002', 'SELECT INBOX')
        clearTimeout(timer)
        await imapCommand(socket, 'A003', 'LOGOUT').catch(() => {})
        socket.destroy()
        if (select.includes('A002 OK')) {
          resolve({ success: true })
        } else {
          resolve({
            success: false,
            error: classifyError(new Error('Unable to SELECT INBOX — read access denied'), 'imap'),
          })
        }
      } catch (err) {
        clearTimeout(timer)
        socket.destroy()
        resolve({ success: false, error: classifyError(err, 'imap') })
      }
    }

    if (input.ssl) {
      const rawSocket = netConnect({ host: input.host, port, timeout: IMAP_TIMEOUT })
      rawSocket.on('error', onError)
      socket = tlsConnect({
        socket: rawSocket,
        rejectUnauthorized: true,
        servername: input.host,
      })
      socket.on('error', onError)
      socket.on('connect', () => {
        void run()
      })
    } else {
      const plainSocket = netConnect({ host: input.host, port, timeout: IMAP_TIMEOUT })
      plainSocket.on('error', onError)
      plainSocket.on('connect', () => {
        socket = plainSocket as unknown as TLSSocket
        void run()
      })
    }
  })
}
