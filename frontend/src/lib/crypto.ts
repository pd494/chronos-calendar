const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12
const SALT_LENGTH = 16

const keyCache = new Map<string, CryptoKey>()

async function deriveKey(userId: string, salt: Uint8Array): Promise<CryptoKey> {
  const cacheKey = `${userId}-${btoa(String.fromCharCode(...salt))}`
  const cached = keyCache.get(cacheKey)
  if (cached) return cached

  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(userId),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )

  keyCache.set(cacheKey, derivedKey)
  return derivedKey
}

export function clearCryptoCache() {
  keyCache.clear()
}

export async function encrypt(plaintext: string, userId: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await deriveKey(userId, salt)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  )

  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return btoa(String.fromCharCode(...combined))
}

export async function decrypt(encryptedData: string, userId: string): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0))

    if (combined.length < SALT_LENGTH + IV_LENGTH + 1) {
      return decryptLegacy(encryptedData, userId)
    }

    const salt = combined.slice(0, SALT_LENGTH)
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH)

    const key = await deriveKey(userId, salt)

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    )

    return new TextDecoder().decode(decrypted)
  } catch {
    return decryptLegacy(encryptedData, userId)
  }
}

async function decryptLegacy(encryptedData: string, userId: string): Promise<string> {
  try {
    const encoder = new TextEncoder()
    const legacySalt = encoder.encode('chronos-todo-salt')
    const key = await deriveKey(userId, legacySalt)

    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0))
    const iv = combined.slice(0, IV_LENGTH)
    const ciphertext = combined.slice(IV_LENGTH)

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    )

    return new TextDecoder().decode(decrypted)
  } catch {
    return encryptedData
  }
}
