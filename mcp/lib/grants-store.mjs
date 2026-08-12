import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from './json-files.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const codesFile = join(here, '..', 'runtime', 'auth-codes.json')
const refreshFile = join(here, '..', 'runtime', 'refresh-tokens.json')

const CODE_TTL_MS = 5 * 60 * 1000
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000

function randomToken() {
  return randomBytes(32).toString('base64url')
}

export async function createAuthorizationCode({ clientId, redirectUri, codeChallenge, codeChallengeMethod, scope }) {
  const codes = await readJson(codesFile, {})
  const code = randomToken()
  codes[code] = {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    expires_at: Date.now() + CODE_TTL_MS,
    used: false,
  }
  await writeJson(codesFile, codes)
  return code
}

// Código de uso único: consumir marca-o logo como usado, mesmo que a troca falhe a seguir
// (evita reutilização em caso de pedido duplicado/replay).
export async function consumeAuthorizationCode(code) {
  const codes = await readJson(codesFile, {})
  const entry = codes[code]
  if (!entry || entry.used || entry.expires_at < Date.now()) return null
  entry.used = true
  await writeJson(codesFile, codes)
  return entry
}

export async function createRefreshToken({ clientId, scope }) {
  const tokens = await readJson(refreshFile, {})
  const token = randomToken()
  tokens[token] = { client_id: clientId, scope, expires_at: Date.now() + REFRESH_TTL_MS, revoked: false }
  await writeJson(refreshFile, tokens)
  return token
}

export async function consumeRefreshToken(token) {
  const tokens = await readJson(refreshFile, {})
  const entry = tokens[token]
  if (!entry || entry.revoked || entry.expires_at < Date.now()) return null
  return entry
}

export async function revokeRefreshToken(token) {
  const tokens = await readJson(refreshFile, {})
  if (tokens[token]) {
    tokens[token].revoked = true
    await writeJson(refreshFile, tokens)
  }
}
