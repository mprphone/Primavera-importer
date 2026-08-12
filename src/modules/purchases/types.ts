export type PurchaseStatus = 'pending' | 'exported'

// Linha de detalhe para faturas com mais do que uma conta de gasto/código de IVA (ex: produtos a
// taxas diferentes na mesma fatura). Quando uma fatura tem detailLines, expenseAccount/vatCode da
// fatura deixam de ser usados na exportação — cada linha gera a sua própria despesa (+ IVA, se
// dedutível) dentro do mesmo lançamento.
export type PurchaseInvoiceLine = {
  id: string
  netAmount: number
  vatAmount: number
  expenseAccount: string
  vatCode: string
}

export type PurchaseInvoice = {
  id: string
  sourceKey: string
  documentDate: string
  documentNo: string
  supplierName: string
  supplierNif: string
  description: string
  netAmount: number
  vatAmount: number
  totalAmount: number
  expenseAccount: string
  vatCode: string
  supplierAccount: string
  journal: string
  documentType: string
  paid: boolean
  paymentAccount: string
  selected: boolean
  status: PurchaseStatus
  exportedAt?: string
  // Quando uma fatura lançada é reaberta (bulk ou individualmente), guarda quando isso aconteceu.
  // Junto com exportedAt, permite à fusão entre dispositivos (mergePurchaseCopies) saber qual dos
  // dois eventos foi o mais recente, em vez de uma cópia desatualizada reverter silenciosamente um
  // export já feito noutro PC.
  reopenedAt?: string
  // Marca manual de quem prepara o TXT — independente da verificação SQL automática. Guarda a
  // data/hora em que a fatura foi conferida à mão para o TXT poder lançar pela mesma ordem em que
  // foram revistas, deixando a capa impressa organizada com os lançamentos.
  reviewedAt: string
  sqlVerification?: {
    status: 'confirmed' | 'possible' | 'missing'
    checkedAt: string
    evidence: string
    movementId?: string
    source?: 'sql' | 'saft' | 'manual'
    // Correspondência encontrada só pelo valor, dentro de um lançamento em lote (ex.: refeições) —
    // sem documento nem fornecedor a confirmar, por isso a UI destaca isto com uma cor distinta.
    lowConfidence?: boolean
    // Diferença aceite apenas porque o NIF foi confirmado através da conta do fornecedor.
    // Mantém a fatura em revisão e permite à UI mostrar o desvio, até 0,02 €, a laranja.
    amountDifference?: number
    // O fornecedor foi identificado pelo campo Entidade do movimento, sem conta corrente 22/27.
    directBank?: boolean
    posting?: {
      journal: string
      number: string
      date: string
      accounts: Array<{
        account: string
        debit: number
        credit: number
        entityType?: string
        entityCode?: string
      }>
    }
    // Preserva o resultado automático quando um humano valida manualmente uma correspondência
    // "a rever" — permite perceber depois porque é que ficou confirmada.
    manualReview?: {
      justification: string
      validatedAt: string
      automaticStatus: 'possible' | 'missing' | 'unchecked'
      automaticEvidence: string
    }
  }
  detailLines?: PurchaseInvoiceLine[]
  intelligence?: { confidence: number; evidence: string }
}

export type SupplierPostingModel = {
  supplierNif: string
  supplierName: string
  expenseAccount: string
  vatCode: string
  supplierAccount: string
  journal: string
  documentType: string
  updatedAt: string
  confirmations?: number
  corrections?: number
}

export type CategoryPostingModel = {
  category: string
  expenseAccount: string
  updatedAt: string
}

export type AccountVatModel = {
  expenseAccount: string
  vatCode: string
  updatedAt: string
}

export type EfaturaImportResult = {
  invoices: PurchaseInvoice[]
  ignored: number
}
