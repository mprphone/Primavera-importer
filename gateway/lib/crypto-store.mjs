import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function encryptionKey(secret) {
  if (!secret || secret.length < 24) {
    throw new Error('PRIMAVERA_GATEWAY_KEY deve ter pelo menos 24 caracteres.')
  }
  return createHash('sha256').update(secret).digest()
}

export async function writeEncryptedJson(file, value, secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  }), { mode: 0o600 })
}

export async function readEncryptedJson(file, secret) {
  const envelope = JSON.parse(await readFile(file, 'utf8'))
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(envelope.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(decrypted.toString('utf8'))
}
