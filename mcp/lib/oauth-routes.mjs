import { createHash } from 'node:crypto'
import express, { Router } from 'express'
import { ensureClient, registerClient } from './clients-store.mjs'
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  createAuthorizationCode,
  createRefreshToken,
  revokeRefreshToken,
} from './grants-store.mjs'
import { issueAccessToken } from './tokens.mjs'
import { getJwks } from './keys.mjs'
import { checkCredentials } from './user.mjs'

const SUBJECT = 'marco' // dono único deste servidor — não há noção de "vários utilizadores"

function serverUrl() {
  return process.env.MCP_SERVER_URL
}

function verifyPkce(codeVerifier, codeChallenge, method) {
  if (method !== 'S256' || !codeVerifier) return false
  const hash = createHash('sha256').update(codeVerifier).digest('base64url')
  return hash === codeChallenge
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function loginPage({ params, error }) {
  const hiddenFields = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('\n')
  return `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><title>Iniciar sessão — mcp.mpr.pt</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; background: #f7f9f7; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form { background: #fff; padding: 32px; border-radius: 14px; border: 1px solid #e4e9e5; width: min(360px, 90vw); box-shadow: 0 8px 28px rgba(33,48,39,.08); }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p { color: #647169; font-size: 13px; margin: 0 0 20px; }
  label { display: block; font-size: 12px; font-weight: 600; margin: 12px 0 4px; }
  input[type="email"], input[type="password"] { width: 100%; padding: 10px 11px; border: 1px solid #e1e7e2; border-radius: 8px; box-sizing: border-box; font: inherit; }
  button { width: 100%; margin-top: 20px; padding: 11px; border: 0; border-radius: 8px; background: #2f6faf; color: #fff; font-weight: 700; cursor: pointer; }
  .error { background: #f8dada; color: #7b3434; padding: 9px 11px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
</style></head>
<body>
  <form method="post" action="/authorize">
    <h1>mcp.mpr.pt</h1>
    <p>Autoriza o acesso às tuas aplicações.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    ${hiddenFields}
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required autofocus>
    <label for="password">Palavra-passe</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Autorizar</button>
  </form>
</body></html>`
}

export function oauthRouter() {
  const router = Router()

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const base = serverUrl()
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      jwks_uri: `${base}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    })
  })

  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    const base = serverUrl()
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
    })
  })

  router.get('/.well-known/jwks.json', async (_req, res) => {
    res.json(await getJwks())
  })

  // RFC 7591 — o claude.ai regista-se sozinho aqui quando adicionas o conector, não há
  // nenhum passo manual para criar um "app" antes disto.
  router.post('/register', express.json(), async (req, res) => {
    try {
      const client = await registerClient({
        redirectUris: req.body?.redirect_uris,
        clientName: req.body?.client_name,
      })
      res.status(201).json({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
    } catch (error) {
      res.status(400).json({ error: error.code || 'invalid_client_metadata', error_description: error.message })
    }
  })

  router.get('/authorize', async (req, res) => {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, scope } = req.query
    if (!client_id || !redirect_uri) return res.status(400).send('client_id e redirect_uri são obrigatórios.')
    const client = await ensureClient(client_id, redirect_uri)
    if (!client.redirect_uris.includes(redirect_uri)) return res.status(400).send('redirect_uri não corresponde ao registado para este cliente.')
    if (code_challenge_method !== 'S256' || !code_challenge) return res.status(400).send('Este servidor exige PKCE (S256).')

    res.set('Content-Type', 'text/html; charset=utf-8').send(loginPage({
      params: { client_id, redirect_uri, code_challenge, code_challenge_method, state: state ?? '', scope: scope ?? 'mcp' },
    }))
  })

  router.post('/authorize', express.urlencoded({ extended: false }), async (req, res) => {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, email, password } = req.body

    if (!checkCredentials(email, password)) {
      return res.status(401).set('Content-Type', 'text/html; charset=utf-8').send(loginPage({
        params: { client_id, redirect_uri, code_challenge, code_challenge_method, state: state ?? '', scope: scope ?? 'mcp' },
        error: 'Email ou palavra-passe incorretos.',
      }))
    }

    const code = await createAuthorizationCode({
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      scope: scope || 'mcp',
    })

    const redirectUrl = new URL(redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (state) redirectUrl.searchParams.set('state', state)
    res.redirect(redirectUrl.toString())
  })

  router.post('/token', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
    const body = req.body || {}
    try {
      if (body.grant_type === 'authorization_code') {
        const grant = await consumeAuthorizationCode(body.code)
        if (!grant) return res.status(400).json({ error: 'invalid_grant', error_description: 'Código inválido, expirado ou já usado.' })
        if (grant.client_id !== body.client_id) return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id não corresponde ao código.' })
        if (grant.redirect_uri !== body.redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri não corresponde ao código.' })
        if (!verifyPkce(body.code_verifier, grant.code_challenge, grant.code_challenge_method)) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier não corresponde ao code_challenge.' })
        }
        const accessToken = await issueAccessToken({ subject: SUBJECT, clientId: grant.client_id, scope: grant.scope })
        const refreshToken = await createRefreshToken({ clientId: grant.client_id, scope: grant.scope })
        return res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
          scope: grant.scope,
        })
      }

      if (body.grant_type === 'refresh_token') {
        const grant = await consumeRefreshToken(body.refresh_token)
        if (!grant) return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token inválido, expirado ou revogado.' })
        if (grant.client_id !== body.client_id) return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id não corresponde ao refresh_token.' })
        // Rotação: revoga o refresh token usado e emite um novo, junto com o novo access token.
        await revokeRefreshToken(body.refresh_token)
        const accessToken = await issueAccessToken({ subject: SUBJECT, clientId: grant.client_id, scope: grant.scope })
        const refreshToken = await createRefreshToken({ clientId: grant.client_id, scope: grant.scope })
        return res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
          scope: grant.scope,
        })
      }

      return res.status(400).json({ error: 'unsupported_grant_type' })
    } catch (error) {
      res.status(500).json({ error: 'server_error', error_description: error.message })
    }
  })

  return router
}
