import { CENTRAL_API_BASE_URL } from './api-config'

export async function issueExtensionToken(label: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${CENTRAL_API_BASE_URL}/extension/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    return payload?.success ? (payload.data?.token as string) ?? null : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}
