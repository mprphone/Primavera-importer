import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJson } from '../lib/json-files.mjs'

function tokensPath(runtimeDirectory) {
  return join(runtimeDirectory, 'extension-tokens.json')
}

export async function loadTokens(runtimeDirectory) {
  return readJson(tokensPath(runtimeDirectory), {})
}

export async function saveTokens(runtimeDirectory, tokens) {
  await writeJson(tokensPath(runtimeDirectory), tokens)
}

export async function isValidToken(runtimeDirectory, token) {
  if (!token) return false
  const tokens = await loadTokens(runtimeDirectory)
  return Boolean(tokens[token])
}

export async function issueAgentToken(runtimeDirectory, label) {
  const tokens = await loadTokens(runtimeDirectory)
  const token = randomBytes(32).toString('hex')
  tokens[token] = { label: label || 'Extensão sem nome', issuedAt: new Date().toISOString() }
  await saveTokens(runtimeDirectory, tokens)
  return token
}
