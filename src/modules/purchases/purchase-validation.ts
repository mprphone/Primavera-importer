import { PurchaseInvoice } from './types'

// Confirma manualmente uma fatura como já lançada no Primavera, preservando o resultado
// automático original (quando existe) para auditoria. Pode ser usado no Controlo ou
// diretamente no detalhe da fatura em Compras.
export function applyManualValidation(invoice: PurchaseInvoice, justification: string): PurchaseInvoice {
  const verification = invoice.sqlVerification
  if (verification?.status === 'confirmed') return invoice
  const validatedAt = new Date().toISOString()
  const trimmedJustification = justification.trim()
  return {
    ...invoice,
    status: 'exported',
    selected: false,
    sqlVerification: {
      ...verification,
      status: 'confirmed',
      source: 'manual',
      evidence: trimmedJustification || 'Validado manualmente pelo utilizador.',
      checkedAt: validatedAt,
      manualReview: {
        justification: trimmedJustification,
        validatedAt,
        automaticStatus: verification?.status ?? 'unchecked',
        automaticEvidence: verification?.evidence ?? 'Sem verificação automática anterior.',
      },
    },
  }
}
