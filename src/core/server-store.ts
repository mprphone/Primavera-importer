import { CENTRAL_API_BASE_URL } from './api-config'

const TIMEOUT_MS = 8_000
const writeQueues = new Map<string, Promise<void>>()

export async function getServerStore<T>(companyCode: string, key: string): Promise<T | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${CENTRAL_API_BASE_URL}/store/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyCode, key }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    return payload?.success ? (payload.data as T) ?? null : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

export function setServerStore(companyCode: string, key: string, data: unknown): Promise<void> {
  const queueKey = `${companyCode}:${key}`
  const previous = writeQueues.get(queueKey) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        await fetch(`${CENTRAL_API_BASE_URL}/store/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyCode, key, data }),
          signal: controller.signal,
        })
      } catch {
        // Escrita best-effort: falhas de rede/servidor nunca devem bloquear a UI. A fila garante
        // que duas gravações rápidas da mesma página chegam pela ordem em que foram feitas — sem
        // isto, uma resposta antiga podia terminar depois e substituir o estado mais recente.
      } finally {
        window.clearTimeout(timeout)
      }
    })
  writeQueues.set(queueKey, current)
  void current.finally(() => {
    if (writeQueues.get(queueKey) === current) writeQueues.delete(queueKey)
  })
  return current
}
