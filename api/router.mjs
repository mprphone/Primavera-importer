import { saveFinancasCredentials } from './credentials/credential-store.mjs'
import { fetchEfaturaInvoices } from './efatura/efatura-route.mjs'
import { relayRequest } from './relay/relay-client.mjs'
import { getStoreValue, setStoreValue, validStoreKey } from './store/store-route.mjs'
import { issueAgentToken } from './tokens/extension-tokens.mjs'

function validCompanyCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value)
}

async function relay(rpc, body) {
  if (typeof body.extensionToken !== 'string' || !body.extensionToken.trim()) {
    return { status: 400, body: { success: false, message: 'Esta empresa ainda não tem um token de extensão configurado.' } }
  }
  try {
    const { message, data } = await relayRequest(body.extensionToken, rpc, body)
    return { status: 200, body: { success: true, message, data } }
  } catch (error) {
    return { status: error.status || 502, body: { success: false, message: error.message } }
  }
}

export async function handleRequest(url, body, runtimeDirectory) {
  if (url === '/api/primavera/extension/token') {
    const token = await issueAgentToken(runtimeDirectory, body.label)
    return { status: 200, body: { success: true, data: { token } } }
  }

  if (!validCompanyCode(body.companyCode)) {
    return { status: 400, body: { success: false, message: 'Código da empresa inválido.' } }
  }

  if (url === '/api/primavera/credentials/financas') {
    if (typeof body.user !== 'string' || !body.user.trim() || typeof body.password !== 'string' || !body.password) {
      return { status: 400, body: { success: false, message: 'Utilizador e palavra-passe são obrigatórios.' } }
    }
    await saveFinancasCredentials(runtimeDirectory, body.companyCode, body.user.trim(), body.password)
    return { status: 200, body: { success: true, message: 'Credenciais cifradas e guardadas na API central.' } }
  }

  if (url === '/api/primavera/efatura/fetch') {
    if (
      typeof body.dateFrom !== 'string' ||
      typeof body.dateTo !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.dateTo) ||
      body.dateFrom > body.dateTo
    ) {
      return { status: 400, body: { success: false, message: 'Período e-Fatura inválido.' } }
    }
    const data = await fetchEfaturaInvoices({
      runtimeDirectory,
      companyCode: body.companyCode,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    })
    return {
      status: 200,
      body: { success: true, message: `${data.invoices?.length ?? 0} faturas recolhidas do e-Fatura.`, data },
    }
  }

  if (url === '/api/primavera/store/get') {
    if (!validStoreKey(body.key)) {
      return { status: 400, body: { success: false, message: 'Chave de armazenamento inválida.' } }
    }
    const data = await getStoreValue(runtimeDirectory, body.companyCode, body.key)
    return { status: 200, body: { success: true, data } }
  }

  if (url === '/api/primavera/store/set') {
    if (!validStoreKey(body.key)) {
      return { status: 400, body: { success: false, message: 'Chave de armazenamento inválida.' } }
    }
    await setStoreValue(runtimeDirectory, body.companyCode, body.key, body.data ?? null)
    return { status: 200, body: { success: true } }
  }

  if (url === '/api/primavera/health') return relay('health', body)
  if (url === '/api/primavera/master-data/sync') return relay('syncMasterData', body)
  if (url === '/api/primavera/master-data/entities') return relay('syncEntities', body)
  if (url === '/api/primavera/postings') return relay('createPostings', body)
  if (url === '/api/primavera/ledger/sync') return relay('syncLedger', body)
  if (url === '/api/primavera/purchases/ledger') return relay('syncPurchases', body)
  if (url === '/api/primavera/intrastat/sales') {
    if (
      typeof body.dateFrom !== 'string' ||
      typeof body.dateTo !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.dateTo) ||
      body.dateFrom > body.dateTo
    ) {
      return { status: 400, body: { success: false, message: 'Período Intrastat inválido.' } }
    }
    return relay('syncIntrastatSales', body)
  }

  return { status: 404, body: { success: false, message: 'Endpoint não encontrado.' } }
}
