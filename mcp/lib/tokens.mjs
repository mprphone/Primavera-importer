import { jwtVerify, SignJWT } from 'jose'
import { getSigningKey, getVerificationKey } from './keys.mjs'

function issuer() {
  const url = process.env.MCP_SERVER_URL
  if (!url) throw new Error('MCP_SERVER_URL em falta no .env')
  return url
}

export async function issueAccessToken({ subject, clientId, scope }) {
  const { privateKey, kid } = await getSigningKey()
  const iss = issuer()
  return new SignJWT({ scope, client_id: clientId })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(iss)
    .setSubject(subject)
    .setExpirationTime('1h')
    .sign(privateKey)
}

export async function verifyAccessToken(token) {
  const { publicKey } = await getVerificationKey()
  const iss = issuer()
  const { payload } = await jwtVerify(token, publicKey, { issuer: iss, audience: iss })
  return payload
}
