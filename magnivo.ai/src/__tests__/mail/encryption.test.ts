import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from '@/lib/encryption'

beforeAll(() => {
  process.env.MAIL_ENCRYPTION_KEY = 'a'.repeat(64)
})

describe('encryption', () => {
  it('encrypts and decrypts a string roundtrip', () => {
    const plaintext = 'my-secret-password-123'
    const ciphertext = encrypt(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext (random salt + iv)', () => {
    const plaintext = 'same-password'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe(plaintext)
    expect(decrypt(b)).toBe(plaintext)
  })

  it('handles empty string', () => {
    const ciphertext = encrypt('')
    expect(decrypt(ciphertext)).toBe('')
  })

  it('handles unicode', () => {
    const plaintext = '日本語パスワード🔑'
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('handles long strings', () => {
    const plaintext = 'x'.repeat(10000)
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('throws on missing MAIL_ENCRYPTION_KEY', () => {
    const original = process.env.MAIL_ENCRYPTION_KEY
    delete process.env.MAIL_ENCRYPTION_KEY
    expect(() => encrypt('test')).toThrow('MAIL_ENCRYPTION_KEY')
    process.env.MAIL_ENCRYPTION_KEY = original
  })

  it('throws on corrupted ciphertext', () => {
    const ciphertext = encrypt('hello')
    const corrupted = ciphertext.slice(0, -4) + 'AAAA'
    expect(() => decrypt(corrupted)).toThrow()
  })

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('hello')
    const buf = Buffer.from(ciphertext, 'base64')
    buf[buf.length - 1] ^= 0xff
    expect(() => decrypt(buf.toString('base64'))).toThrow()
  })
})
