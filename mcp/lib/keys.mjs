import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, importJWK } from 'jose'
import { readJson, writeJson } from './json-files.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const keysFile = join(here, '..', 'runtime', 'keys.json')

let cached = null

// Chave RS256 gerada uma vez e guardada em disco — assina os access tokens (JWT) emitidos
// pelo /token e é o que o servidor MCP verifica em cada pedido (via /.well-known/jwks.json).
async function loadOrCreateKeys() {
  if (cached) return cached
  const stored = await readJson(keysFile, null)
  if (stored) {
    const privateKey = await importJWK(stored.privateJwk, 'RS256')
    cached = { privateKey, publicJwk: stored.publicJwk, kid: stored.kid }
    return cached
  }
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
  const kid = randomUUID()
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  const privateJwk = { ...(await exportJWK(privateKey)), kid }
  await writeJson(keysFile, { kid, publicJwk, privateJwk })
  cached = { privateKey, publicJwk, kid }
  return cached
}

export async function getSigningKey() {
  const { privateKey, kid } = await loadOrCreateKeys()
  return { privateKey, kid }
}

// Verificação de RS256 precisa da chave pública (a privada só serve para assinar) — importa-a
// do mesmo JWK guardado em disco.
export async function getVerificationKey() {
  const { publicJwk, kid } = await loadOrCreateKeys()
  const publicKey = await importJWK(publicJwk, 'RS256')
  return { publicKey, kid }
}

export async function getJwks() {
  const { publicJwk } = await loadOrCreateKeys()
  return { keys: [publicJwk] }
}
