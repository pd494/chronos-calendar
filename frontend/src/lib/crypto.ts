import { api } from '../api/client'

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12
const SALT_LENGTH = 16
const VERSION_BYTE_V2 = 0x02
const AAD_PREFIX = new TextEncoder().encode('chronos-v1:')

let encryptionKey: CryptoKey | null = null
let currentUserId: string | null = null

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptionError'
  }
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

function buildAad(userId: string): Uint8Array {
  const userIdBytes = new TextEncoder().encode(userId)
  const aad = new Uint8Array(AAD_PREFIX.length + userIdBytes.length)
  aad.set(AAD_PREFIX)
  aad.set(userIdBytes, AAD_PREFIX.length)
  return aad
}

export async function fetchEncryptionKey(userId: string): Promise<void> {
  const response = await api.get<{ key: string; salt: string }>('/auth/encryption-key')
  encryptionKey = await importKey(response.key)
  currentUserId = userId
}

export function clearCryptoCache(): void {
  encryptionKey = null
  currentUserId = null
}

export function hasEncryptionKey(): boolean {
  return encryptionKey !== null
}

async function getKeyAndUserId(): Promise<{ key: CryptoKey; userId: string }> {
  if (!encryptionKey || !currentUserId) {
    throw new Error('Encryption key not available. Call fetchEncryptionKey first.')
  }
  return { key: encryptionKey, userId: currentUserId }
}

export async function encrypt(plaintext: string): Promise<string> {
  const { key, userId } = await getKeyAndUserId()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const aad = buildAad(userId)
  const encoder = new TextEncoder()

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: aad },
    key,
    encoder.encode(plaintext)
  )

  const combined = new Uint8Array(1 + salt.length + iv.length + ciphertext.byteLength)
  combined[0] = VERSION_BYTE_V2
  combined.set(salt, 1)
  combined.set(iv, 1 + salt.length)
  combined.set(new Uint8Array(ciphertext), 1 + salt.length + iv.length)

  return btoa(String.fromCharCode(...combined))
}

export async function decrypt(encryptedData: string): Promise<string> {
  const { key, userId } = await getKeyAndUserId()
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0))

  if (combined[0] === VERSION_BYTE_V2) {
    const minLength = 1 + SALT_LENGTH + IV_LENGTH + 1
    if (combined.length < minLength) {
      throw new DecryptionError('Invalid encrypted data: too short for v2 format')
    }

    const iv = combined.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH)
    const ciphertext = combined.slice(1 + SALT_LENGTH + IV_LENGTH)
    const aad = buildAad(userId)

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv, additionalData: aad },
        key,
        ciphertext
      )
      return new TextDecoder().decode(decrypted)
    } catch {
      throw new DecryptionError('Decryption failed: invalid key or corrupted data')
    }
  }

  if (combined.length < IV_LENGTH + 1) {
    throw new DecryptionError('Invalid encrypted data: too short')
  }

  const iv = combined.slice(0, IV_LENGTH)
  const ciphertext = combined.slice(IV_LENGTH)

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    throw new DecryptionError('Decryption failed: invalid key or corrupted data')
  }
}
