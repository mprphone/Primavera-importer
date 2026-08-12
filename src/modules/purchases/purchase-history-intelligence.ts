import { VatRegime } from '../../core/clients'
import { PrimaveraMasterData } from '../../core/master-data'
import { LedgerMovement } from '../../core/primavera'
import { groupPurchaseLedgerPostings, PurchaseLedgerPosting } from './purchase-reconciliation'
import { PurchaseInvoice } from './types'
import { vatCodeOptionsForExpenseAccount } from './vat-class-pattern'

export type PurchaseHistorySuggestion = {
  expenseAccount: string
  vatCode: string
  supplierAccount: string
  observations: number
  confidence: number
  evidence: string
}

export type PurchaseHistoryIndex = {
  verifiedBySupplier: Map<string, PurchaseLedgerPosting[]>
  ledgerByAccount: Map<string, PurchaseLedgerPosting[]>
}

function amountOf(line: PurchaseLedgerPosting['accounts'][number]) {
  return Math.max(Math.abs(line.debit), Math.abs(line.credit))
}

function supplierKeys(invoice: PurchaseInvoice) {
  const keys: string[] = []
  if (invoice.supplierNif) keys.push(`nif:${invoice.supplierNif}`)
  if (invoice.supplierAccount) keys.push(`account:${invoice.supplierAccount}`)
  return keys
}

function addToIndex(index: Map<string, PurchaseLedgerPosting[]>, key: string, posting: PurchaseLedgerPosting) {
  const entries = index.get(key) ?? []
  entries.push(posting)
  index.set(key, entries)
}

function postingSignature(posting: PurchaseLedgerPosting) {
  const accounts = posting.accounts
    .map(line => `${line.account}:${line.debit.toFixed(2)}:${line.credit.toFixed(2)}`)
    .sort()
    .join('|')
  return `${posting.date}|${posting.journal}|${posting.number}|${accounts}`
}

function codeFromVatPosting(
  posting: PurchaseLedgerPosting,
  expenseAccount: string,
  invoice: PurchaseInvoice,
  masterData: PrimaveraMasterData,
  vatRegime: VatRegime,
) {
  if (vatRegime === 'isento' || !invoice.vatAmount) return ''
  const postingAccounts = new Set(posting.accounts.filter(line => amountOf(line) > 0).map(line => line.account))
  const allowedCodes = new Set(vatCodeOptionsForExpenseAccount(masterData, expenseAccount).map(rate => rate.code))
  const candidates = masterData.vatRates.filter(rate =>
    rate.account
    && postingAccounts.has(rate.account)
    && allowedCodes.has(rate.code),
  )
  if (!candidates.length) return ''
  const effectiveRate = invoice.netAmount ? Math.abs(invoice.vatAmount / invoice.netAmount * 100) : 0
  return [...candidates].sort((left, right) =>
    Math.abs(left.rate - effectiveRate) - Math.abs(right.rate - effectiveRate)
  )[0].code
}

function patternFromPosting(
  posting: PurchaseLedgerPosting,
  invoice: PurchaseInvoice,
  masterData: PrimaveraMasterData,
  vatRegime: VatRegime,
) {
  // Para compras correntes, as contas de gasto são da classe 6. Não tenta adivinhar
  // imobilizado/inventário porque aí é preferível uma decisão explícita do utilizador.
  const expenseLine = posting.accounts
    .filter(line => /^6/.test(line.account) && amountOf(line) > 0)
    .sort((left, right) => amountOf(right) - amountOf(left))[0]
  if (!expenseLine) return null
  const vatCode = codeFromVatPosting(posting, expenseLine.account, invoice, masterData, vatRegime)
  return { expenseAccount: expenseLine.account, vatCode }
}

export function buildPurchaseHistoryIndex(
  invoices: PurchaseInvoice[],
  ledgerMovements: LedgerMovement[],
): PurchaseHistoryIndex {
  const verifiedBySupplier = new Map<string, PurchaseLedgerPosting[]>()
  invoices.forEach(invoice => {
    const posting = invoice.sqlVerification?.posting
    if (invoice.sqlVerification?.status !== 'confirmed' || !posting) return
    supplierKeys(invoice).forEach(key => addToIndex(verifiedBySupplier, key, posting))
  })

  const ledgerByAccount = new Map<string, PurchaseLedgerPosting[]>()
  groupPurchaseLedgerPostings(ledgerMovements).forEach(posting => {
    new Set(posting.accounts.map(line => line.account).filter(Boolean))
      .forEach(account => addToIndex(ledgerByAccount, account, posting))
  })
  return { verifiedBySupplier, ledgerByAccount }
}

export function suggestPurchaseFromHistory(
  invoice: PurchaseInvoice,
  history: PurchaseHistoryIndex,
  masterData: PrimaveraMasterData,
  vatRegime: VatRegime,
): PurchaseHistorySuggestion | null {
  const invoiceMonth = invoice.documentDate.slice(0, 7)
  const postings = new Map<string, PurchaseLedgerPosting>()

  supplierKeys(invoice).forEach(key => {
    history.verifiedBySupplier.get(key)?.forEach(posting => {
      if (posting.date.slice(0, 7) < invoiceMonth) postings.set(postingSignature(posting), posting)
    })
  })

  if (invoice.supplierAccount) {
    history.ledgerByAccount.get(invoice.supplierAccount)?.forEach(posting => {
      if (posting.date.slice(0, 7) < invoiceMonth) postings.set(postingSignature(posting), posting)
    })
  }

  const patterns = new Map<string, {
    expenseAccount: string
    vatCode: string
    count: number
  }>()
  postings.forEach(posting => {
    const pattern = patternFromPosting(posting, invoice, masterData, vatRegime)
    if (!pattern) return
    const key = `${pattern.expenseAccount}|${pattern.vatCode}`
    const existing = patterns.get(key)
    patterns.set(key, { ...pattern, count: (existing?.count ?? 0) + 1 })
  })

  const ranked = Array.from(patterns.values()).sort((left, right) => right.count - left.count)
  const best = ranked[0]
  if (!best) return null
  const total = ranked.reduce((sum, pattern) => sum + pattern.count, 0)
  const agreement = best.count / total
  const confidence = Math.min(96, Math.round(48 + agreement * 18 + Math.min(30, best.count * 6)))
  const supplierAccount = invoice.supplierAccount
    || Array.from(postings.values())
      .flatMap(posting => posting.accounts)
      .find(line => /^2[27]/.test(line.account))?.account
    || ''

  return {
    expenseAccount: best.expenseAccount,
    vatCode: best.vatCode,
    supplierAccount,
    observations: best.count,
    confidence,
    evidence: best.count === total
      ? `padrão encontrado em ${best.count} ${best.count === 1 ? 'lançamento anterior' : 'lançamentos anteriores'} deste fornecedor no Primavera`
      : `padrão mais frequente em ${best.count} de ${total} lançamentos anteriores deste fornecedor no Primavera`,
  }
}

export function applyPurchaseHistorySuggestion(
  invoice: PurchaseInvoice,
  suggestion: PurchaseHistorySuggestion,
): PurchaseInvoice {
  const expenseAccount = invoice.expenseAccount || suggestion.expenseAccount
  const vatCode = invoice.vatCode || suggestion.vatCode
  const supplierAccount = invoice.supplierAccount || suggestion.supplierAccount
  const changed = expenseAccount !== invoice.expenseAccount
    || vatCode !== invoice.vatCode
    || supplierAccount !== invoice.supplierAccount
  if (!changed) return invoice
  return {
    ...invoice,
    expenseAccount,
    vatCode,
    supplierAccount,
    intelligence: !invoice.intelligence || suggestion.confidence > invoice.intelligence.confidence
      ? { confidence: suggestion.confidence, evidence: suggestion.evidence }
      : invoice.intelligence,
  }
}
