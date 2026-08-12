export type EfaturaPortalRow = {
  document_date: string
  document_no: string
  party_name: string
  party_nif: string
  description: string
  net_amount: string
  vat_amount: string
  total_amount: string
}

export async function fetchEfaturaMonth(
  gatewayUrl: string,
  companyCode: string,
  dateFrom: string,
  dateTo: string,
) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 190_000)
  try {
    const response = await fetch(`${gatewayUrl}/efatura/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyCode, dateFrom, dateTo }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || 'Não foi possível recolher as faturas.')
    return {
      message: String(payload.message || 'Recolha concluída.'),
      rows: (payload.data?.invoices ?? []) as EfaturaPortalRow[],
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A recolha no e-Fatura ultrapassou 3 minutos.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}
