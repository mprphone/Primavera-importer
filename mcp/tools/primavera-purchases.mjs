import { getStoreValue, setStoreValue } from './primavera-store-client.mjs'

async function loadClients() {
  const clients = await getStoreValue('_global', 'custom_clients')
  return Array.isArray(clients) ? clients : []
}

async function loadPurchases(empresaId) {
  const invoices = await getStoreValue(empresaId, 'purchases')
  return Array.isArray(invoices) ? invoices : []
}

async function savePurchases(empresaId, invoices) {
  await setStoreValue(empresaId, 'purchases', invoices)
}

function summarize(invoice) {
  return {
    id: invoice.id,
    documento: invoice.documentNo,
    data: invoice.documentDate,
    fornecedor: invoice.supplierName,
    nif: invoice.supplierNif,
    total: invoice.totalAmount,
    estado: invoice.sqlVerification?.status ?? 'por_verificar',
    motivo: invoice.sqlVerification?.evidence,
  }
}

export async function listCompanies() {
  const clients = await loadClients()
  return clients.map(client => ({
    id: client.id,
    nome: client.name,
    nif: client.nif,
    localizacao: client.location,
  }))
}

export async function listPurchaseInvoices({ empresaId, estado, mes, fornecedor }) {
  const invoices = await loadPurchases(empresaId)
  return invoices
    .filter(invoice => {
      if (estado && estado !== 'todas') {
        const status = invoice.sqlVerification?.status
        if (estado === 'por_verificar') {
          if (status) return false
        } else if (status !== estado) {
          return false
        }
      }
      if (mes && !invoice.documentDate?.startsWith(mes)) return false
      if (fornecedor) {
        const needle = fornecedor.toLowerCase()
        const matchesName = invoice.supplierName?.toLowerCase().includes(needle)
        const matchesNif = invoice.supplierNif === fornecedor
        if (!matchesName && !matchesNif) return false
      }
      return true
    })
    .map(summarize)
}

export async function getPurchaseInvoiceDetail({ empresaId, faturaId }) {
  const invoices = await loadPurchases(empresaId)
  return invoices.find(item => item.id === faturaId || item.documentNo === faturaId) ?? null
}

// Espelha applyManualValidation em src/modules/purchases/purchase-validation.ts — mantém o
// mesmo formato de dados para que a app e o MCP nunca divirjam sobre o que significa "validado".
export async function validatePurchaseInvoiceManually({ empresaId, faturaId, justificacao }) {
  const invoices = await loadPurchases(empresaId)
  const index = invoices.findIndex(item => item.id === faturaId || item.documentNo === faturaId)
  if (index === -1) throw new Error('Fatura não encontrada.')

  const invoice = invoices[index]
  const verification = invoice.sqlVerification
  if (!verification) throw new Error('Esta fatura ainda não foi verificada no Primavera — usa "Verificar no Primavera" na app primeiro.')
  if (verification.status === 'confirmed') throw new Error('Esta fatura já está confirmada.')

  const trimmedJustification = (justificacao ?? '').trim()
  const updated = {
    ...invoice,
    status: 'exported',
    selected: false,
    sqlVerification: {
      ...verification,
      status: 'confirmed',
      source: 'manual',
      evidence: trimmedJustification || 'Validado manualmente via MCP.',
      checkedAt: new Date().toISOString(),
      manualReview: {
        justification: trimmedJustification,
        validatedAt: new Date().toISOString(),
        automaticStatus: verification.status,
        automaticEvidence: verification.evidence,
      },
    },
  }
  invoices[index] = updated
  await savePurchases(empresaId, invoices)
  return updated
}
