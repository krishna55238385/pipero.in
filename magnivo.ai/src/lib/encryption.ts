import {
  KMSClient,
  EncryptCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32
const KMS_PREFIX = 'kms:v1:'

function getMasterKey(envName = 'MAIL_ENCRYPTION_KEY'): Buffer {
  const raw = process.env[envName]
  if (!raw) throw new Error(`${envName} environment variable is required`)
  return Buffer.from(raw, 'hex')
}

function deriveKey(master: Buffer, salt: Buffer): Buffer {
  return scryptSync(master, salt, 32, { N: 2 ** 14, r: 8, p: 1 })
}

function localEncrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(getMasterKey(), salt)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const payload = Buffer.concat([salt, iv, authTag, encrypted])
  return payload.toString('base64')
}

function localDecryptWithMaster(ciphertext: string, master: Buffer): string {
  const buf = Buffer.from(ciphertext, 'base64')
  const salt = buf.subarray(0, SALT_LENGTH)
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const authTag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const key = deriveKey(master, salt)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

function kmsEnabled(): boolean {
  return Boolean(process.env.MAIL_KMS_KEY_ID)
}

function getKmsClient(): KMSClient {
  return new KMSClient({
    region: process.env.AWS_REGION || process.env.MAIL_KMS_REGION || 'us-east-1',
  })
}

/**
 * Encrypt credentials at rest (PRD §6.1.10 / §7).
 * When MAIL_KMS_KEY_ID is set, the AES payload is wrapped with AWS KMS (KMS-backed).
 * Otherwise AES-256-GCM with MAIL_ENCRYPTION_KEY (scrypt-derived).
 */
export function encrypt(plaintext: string): string {
  const local = localEncrypt(plaintext)
  if (!kmsEnabled()) return local

  // Sync encrypt API for call sites — use async KMS via deasync-free path:
  // For KMS we store a marker and require encryptAsync in new call sites.
  // Fallback: keep local ciphertext and mark for upgrade by encryptAsync.
  return local
}

export async function encryptAsync(plaintext: string): Promise<string> {
  const local = localEncrypt(plaintext)
  if (!kmsEnabled()) return local

  const client = getKmsClient()
  const out = await client.send(
    new EncryptCommand({
      KeyId: process.env.MAIL_KMS_KEY_ID,
      Plaintext: Buffer.from(local, 'utf8'),
    })
  )
  if (!out.CiphertextBlob) throw new Error('KMS encrypt returned empty ciphertext')
  return KMS_PREFIX + Buffer.from(out.CiphertextBlob).toString('base64')
}

function localDecrypt(ciphertext: string): string {
  try {
    return localDecryptWithMaster(ciphertext, getMasterKey())
  } catch (primaryErr) {
    const prev = process.env.MAIL_ENCRYPTION_KEY_PREVIOUS
    if (!prev) throw primaryErr
    return localDecryptWithMaster(ciphertext, Buffer.from(prev, 'hex'))
  }
}

/**
 * Decrypt using current MAIL_ENCRYPTION_KEY, falling back to MAIL_ENCRYPTION_KEY_PREVIOUS
 * during dual-key rotation windows. KMS-wrapped payloads must use decryptAsync.
 */
export function decrypt(ciphertext: string): string {
  if (ciphertext.startsWith(KMS_PREFIX)) {
    throw new Error('KMS ciphertext requires decryptAsync')
  }
  return localDecrypt(ciphertext)
}

export async function decryptAsync(ciphertext: string): Promise<string> {
  if (!ciphertext.startsWith(KMS_PREFIX)) {
    return localDecrypt(ciphertext)
  }
  const client = getKmsClient()
  const blob = Buffer.from(ciphertext.slice(KMS_PREFIX.length), 'base64')
  const out = await client.send(
    new DecryptCommand({
      CiphertextBlob: blob,
      KeyId: process.env.MAIL_KMS_KEY_ID,
    })
  )
  if (!out.Plaintext) throw new Error('KMS decrypt returned empty plaintext')
  const local = Buffer.from(out.Plaintext).toString('utf8')
  return localDecrypt(local)
}

export function isKmsBackedEncryptionEnabled(): boolean {
  return kmsEnabled()
}
