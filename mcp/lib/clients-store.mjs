import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from './json-files.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'runtime', 'clients.json')

async function load() {
  return readJson(file, {})
}

// O claude.ai regista-se sozinho como cliente (RFC 7591) quando adicionas o conector — não há
// nenhum ecrã onde crias isto à mão. Só suportamos clientes públicos (PKCE obrigatório, sem
// client_secret), que é o que o claude.ai usa.
export async function registerClient({ redirectUris, clientName }) {
  if (!Array.isArray(redirectUris) || !redirectUris.length) {
    throw Object.assign(new Error('redirect_uris é obrigatório'), { code: 'invalid_redirect_uri' })
  }
  const clients = await load()
  const clientId = randomUUID()
  const client = {
    client_id: clientId,
    client_name: clientName || 'Cliente MCP',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    created_at: new Date().toISOString(),
  }
  clients[clientId] = client
  await writeJson(file, clients)
  return client
}

export async function getClient(clientId) {
  const clients = await load()
  return clients[clientId] ?? null
}

// Nem todos os clientes fazem RFC 7591 (POST /register) antes de chegar a /authorize — o
// claude.ai, por exemplo, por vezes salta esse passo e aparece diretamente em /authorize com
// um client_id à escolha dele. Como só há um utilizador e o login continua a exigir
// email/palavra-passe, tratamos o primeiro contacto em /authorize como registo implícito.
export async function ensureClient(clientId, redirectUri) {
  const clients = await load()
  const existing = clients[clientId]
  if (existing) {
    if (!existing.redirect_uris.includes(redirectUri)) {
      existing.redirect_uris.push(redirectUri)
      await writeJson(file, clients)
    }
    return existing
  }
  const client = {
    client_id: clientId,
    client_name: 'Cliente auto-registado em /authorize',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    created_at: new Date().toISOString(),
  }
  clients[clientId] = client
  await writeJson(file, clients)
  return client
}
