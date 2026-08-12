import { timingSafeEqual } from 'node:crypto'

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''))
  const bufB = Buffer.from(String(b ?? ''))
  // Comprimentos diferentes já denunciam a diferença por timing; para bloquear isso também
  // seria preciso comparar sempre o mesmo número de bytes (hash de tamanho fixo em vez do
  // valor em bruto) — não vale a pena para uma conta única e pessoal.
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Dono único do servidor — credenciais em .env, ao mesmo nível de confiança das outras
// chaves/segredos já guardados em .env neste projeto.
export function checkCredentials(email, password) {
  const expectedEmail = process.env.MCP_OWNER_EMAIL ?? ''
  const expectedPassword = process.env.MCP_OWNER_PASSWORD ?? ''
  if (!expectedEmail || !expectedPassword) return false
  return safeEqual(email, expectedEmail) && safeEqual(password, expectedPassword)
}
