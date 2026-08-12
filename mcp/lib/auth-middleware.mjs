import { verifyAccessToken } from './tokens.mjs'

export async function requireAuth(req, res, next) {
  const header = req.headers['authorization']
  if (!header?.startsWith('Bearer ')) {
    const base = process.env.MCP_SERVER_URL
    res
      .status(401)
      .set('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${base}/.well-known/oauth-protected-resource"`)
      .json({ error: 'invalid_token', error_description: 'Falta o cabeçalho Authorization: Bearer <token>' })
    return
  }

  const token = header.slice('Bearer '.length)
  try {
    req.auth = await verifyAccessToken(token)
    next()
  } catch (error) {
    console.error('[auth] Falha na verificação do token:', error.message)
    res.status(401).json({ error: 'invalid_token', error_description: 'Token inválido ou expirado.' })
  }
}
