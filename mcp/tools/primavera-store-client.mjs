// Cliente fino sobre a mesma API HTTP que o frontend do primavera-importer já usa
// (getServerStore/setServerStore em src/core/server-store.ts) — lê e escreve os mesmos
// ficheiros JSON que a app mostra, por isso qualquer alteração feita por aqui aparece logo lá.

const BASE_URL = process.env.PRIMAVERA_API_BASE_URL ?? 'https://pri.mpr.pt/api/primavera'
const TIMEOUT_MS = 10_000

async function callStore(path, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`primavera-importer respondeu ${response.status}`)
    return response.json().catch(() => null)
  } finally {
    clearTimeout(timeout)
  }
}

export async function getStoreValue(companyCode, key) {
  const payload = await callStore('/store/get', { companyCode, key })
  return payload?.success ? payload.data ?? null : null
}

export async function setStoreValue(companyCode, key, data) {
  const payload = await callStore('/store/set', { companyCode, key, data })
  if (!payload?.success) throw new Error(payload?.message || 'Não foi possível gravar no primavera-importer.')
}
