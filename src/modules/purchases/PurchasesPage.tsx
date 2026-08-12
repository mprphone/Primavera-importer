import React, { useEffect, useMemo, useRef, useState } from 'react'
import { VatRegime } from '../../core/clients'
import { PrimaveraMasterData } from '../../core/master-data'
import { downloadPurchaseTxt } from './download'
import { detectCategory } from './category-classifier'
import { parseEfaturaFile } from './efatura-parser'
import { parseEfaturaPortalRows } from './efatura-parser'
import { PurchaseInvoiceRow } from './PurchaseInvoiceRow'
import { PurchaseIcon } from './PurchaseIcon'
import { EfaturaFetchDialog } from './EfaturaFetchDialog'
import { fetchEfaturaMonth } from './efatura-client'
import {
  applyAccountVat,
  applyCategoryModel,
  applySupplierModel,
  loadAccountVatMap,
  loadCategoryModels,
  loadPurchases,
  loadSupplierModels,
  mergePurchases,
  refreshAccountVatMapFromServer,
  refreshCategoryModelsFromServer,
  refreshPurchasesFromServer,
  refreshSupplierModelsFromServer,
  savePurchases,
  saveAccountVatMap,
  saveCategoryModels,
  saveSupplierModels,
} from './purchase-storage'
import { exportUnconfirmedInvoicesPdf } from './purchase-pdf'
import {
  applyPurchaseHistorySuggestion,
  buildPurchaseHistoryIndex,
  PurchaseHistorySuggestion,
  suggestPurchaseFromHistory,
} from './purchase-history-intelligence'
import { applyManualValidation } from './purchase-validation'
import { generatePurchasesTxt, isInvoiceReadyForExport, validatePurchasesForExport } from './purchase-txt'
import { AccountVatModel, CategoryPostingModel, PurchaseInvoice, SupplierPostingModel } from './types'
import './purchases.css'
import { learnSmartRule, seedSmartRule, suggestSmartRule } from '../../core/smart-rules'
import { useFeedback } from '../../ui/feedback/FeedbackCenter'
import { analyzeFile, FileAnalysis } from '../../core/file-intelligence'
import { FilePreviewDialog } from '../../ui/components/FilePreviewDialog'
import { PrimaveraGatewayConnector, SqlConnectionSettings } from '../../core/primavera'
import {
  hasMonthlyConsolidatedPosting,
  isPayableAccount,
  matchAgainstLumpAccountLines,
  matchMonthlyConsolidatedPurchases,
  matchPurchaseInLedger,
  matchViaVerdeIndividualPurchases,
  prefersIndividualPurchaseMatch,
  resolveMovementConflicts,
} from './purchase-reconciliation'

type Props = {
  clientId: string
  clientName: string
  year: number
  startNumber: number
  defaultJournal: string
  defaultDocument: string
  gatewayUrl: string
  companyCode: string
  sql: SqlConnectionSettings
  extensionToken: string
  masterData: PrimaveraMasterData
  vatRegime: VatRegime
  onDefaultJournalChange: (value: string) => void
  onDefaultDocumentChange: (value: string) => void
}

function paginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const pages = Array.from(new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]))
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)

  const items: Array<number | 'ellipsis'> = []
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) items.push('ellipsis')
    items.push(page)
  })
  return items
}

function isPurchaseErrorMessage(message: string) {
  return /não|erro|inválid|sem espaço|falh|exception|not a recognized|failed|timeout/i.test(message)
}

function rememberHistorySuggestion(
  draft: Record<string, SupplierPostingModel>,
  invoice: PurchaseInvoice,
  suggestion: PurchaseHistorySuggestion,
) {
  if (!invoice.supplierNif) return false
  const existing = draft[invoice.supplierNif]
  const next: SupplierPostingModel = {
    supplierNif: invoice.supplierNif,
    supplierName: invoice.supplierName,
    expenseAccount: existing?.expenseAccount || suggestion.expenseAccount,
    vatCode: existing?.vatCode || suggestion.vatCode,
    supplierAccount: existing?.supplierAccount || suggestion.supplierAccount || invoice.supplierAccount,
    journal: existing?.journal || invoice.journal,
    documentType: existing?.documentType || invoice.documentType,
    updatedAt: new Date().toISOString(),
    confirmations: Math.max(existing?.confirmations ?? 0, suggestion.observations),
    corrections: existing?.corrections ?? 0,
  }
  if (
    existing
    && existing.expenseAccount === next.expenseAccount
    && existing.vatCode === next.vatCode
    && existing.supplierAccount === next.supplierAccount
    && existing.journal === next.journal
    && existing.documentType === next.documentType
    && (existing.confirmations ?? 0) >= (next.confirmations ?? 0)
  ) return false
  draft[invoice.supplierNif] = next
  return true
}

export function PurchasesPage({
  clientId, clientName, year, startNumber, defaultJournal, defaultDocument, gatewayUrl, companyCode, sql, extensionToken, masterData, vatRegime,
  onDefaultJournalChange, onDefaultDocumentChange,
}: Props) {
  const { notify } = useFeedback()
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>(() => loadPurchases(clientId))
  const [models, setModels] = useState<Record<string, SupplierPostingModel>>(() => loadSupplierModels(clientId))
  const [categoryModels, setCategoryModels] = useState<Record<string, CategoryPostingModel>>(() => loadCategoryModels(clientId))
  const [accountVatMap, setAccountVatMap] = useState<Record<string, AccountVatModel>>(() => loadAccountVatMap(clientId))
  const [message, setMessage] = useState('')
  const [showExported, setShowExported] = useState(false)
  const [showEfatura, setShowEfatura] = useState(false)
  const [fetchingEfatura, setFetchingEfatura] = useState(false)
  const [checkingSql, setCheckingSql] = useState(false)
  const checkingSqlRef = useRef(false)
  const [purchasesHydrated, setPurchasesHydrated] = useState(false)
  const [monthFilter, setMonthFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [sqlFilter, setSqlFilter] = useState<'all' | 'confirmed' | 'possible' | 'missing' | 'unchecked'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [sortField, setSortField] = useState<'date' | 'supplier' | 'total' | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [exportErrorIds, setExportErrorIds] = useState<Set<string>>(new Set())
  const [detectedFile, setDetectedFile] = useState<{ file: File; analysis: FileAnalysis } | null>(null)

  useEffect(() => {
    if (!message) return
    notify({ kind: isPurchaseErrorMessage(message) ? 'error' : 'success', title: 'Compras', detail: message })
  }, [message, notify])

  useEffect(() => {
    Object.values(models).forEach(model => seedSmartRule(clientId, 'purchase', `${model.supplierName} ${model.supplierNif}`, {
      expenseAccount: model.expenseAccount, vatCode: model.vatCode, supplierAccount: model.supplierAccount,
      journal: model.journal, documentType: model.documentType,
    }))
    Object.values(categoryModels).forEach(model => seedSmartRule(clientId, 'purchase', model.category, { expenseAccount: model.expenseAccount }))
  }, [clientId, models, categoryModels])

  useEffect(() => {
    let cancelled = false
    setPurchasesHydrated(false)
    refreshPurchasesFromServer(clientId)
      .then(remote => { if (!cancelled && remote) setInvoices(remote) })
      .finally(() => { if (!cancelled) setPurchasesHydrated(true) })
    refreshSupplierModelsFromServer(clientId).then(remote => { if (!cancelled && remote) setModels(remote) })
    refreshCategoryModelsFromServer(clientId).then(remote => { if (!cancelled && remote) setCategoryModels(remote) })
    refreshAccountVatMapFromServer(clientId).then(remote => { if (!cancelled && remote) setAccountVatMap(remote) })
    return () => { cancelled = true }
  }, [clientId])

  // Migração de faturas gravadas antes da troca "Conta IVA" -> "Código IVA": o campo guardado
  // chamava-se vatAccount (uma conta). Tenta resolver o código correspondente nessa conta; se não
  // encontrar (master data ainda não sincronizado), usa o valor antigo como ponto de partida em vez
  // de perder silenciosamente o que já tinha sido preenchido/corrigido manualmente.
  useEffect(() => {
    if (!purchasesHydrated) return
    const needsMigration = invoices.some(invoice => !invoice.vatCode && (invoice as Record<string, unknown>).vatAccount)
    if (!needsMigration) return
    persist(invoices.map(invoice => {
      const { vatAccount: legacyAccount, ...rest } = invoice as PurchaseInvoice & { vatAccount?: string }
      if (invoice.vatCode || !legacyAccount) return invoice
      const vatCode = masterData.vatRates.find(rate => rate.account === legacyAccount)?.code ?? legacyAccount
      return { ...rest, vatCode }
    }))
  }, [invoices, masterData.vatRates, purchasesHydrated])

  useEffect(() => {
    if (!purchasesHydrated) return
    if (!defaultJournal && !defaultDocument) return
    const needsFill = invoices.some(invoice =>
      (defaultJournal && !invoice.journal.trim()) || (defaultDocument && !invoice.documentType.trim())
    )
    if (!needsFill) return
    persist(invoices.map(invoice => ({
      ...invoice,
      journal: invoice.journal.trim() || defaultJournal,
      documentType: invoice.documentType.trim() || defaultDocument,
    })))
  }, [defaultJournal, defaultDocument, invoices, purchasesHydrated])

  const months = useMemo(() => {
    const unique = new Set(invoices.map(invoice => invoice.documentDate.slice(0, 7)).filter(Boolean))
    return Array.from(unique).sort().reverse()
  }, [invoices])

  const suppliers = useMemo(() => {
    const unique = new Map(invoices.map(invoice => [invoice.supplierNif || invoice.supplierName, invoice.supplierName]))
    return Array.from(unique.entries())
      .filter(([key]) => key)
      .sort((a, b) => a[1].localeCompare(b[1]))
  }, [invoices])

  // O mês/fornecedor definem o âmbito de trabalho. Todos os contadores e ações operacionais
  // abaixo usam este conjunto, para nunca mostrar totais anuais quando o utilizador está a
  // trabalhar, por exemplo, apenas em junho.
  const contextualInvoices = useMemo(
    () => invoices.filter(invoice =>
      (!monthFilter || invoice.documentDate.startsWith(monthFilter))
      && (!supplierFilter || (invoice.supplierNif || invoice.supplierName) === supplierFilter),
    ),
    [invoices, monthFilter, supplierFilter],
  )
  const contextualInvoiceIds = useMemo(
    () => new Set(contextualInvoices.map(invoice => invoice.id)),
    [contextualInvoices],
  )
  // Posição de cada fatura na ordem em que foi conferida à mão (dentro do mês/fornecedor em
  // vista) — mostrado como "✔ (N)" para quem prepara o TXT acompanhar por onde vai.
  const reviewOrder = useMemo(() => {
    const order = new Map<string, number>()
    contextualInvoices
      .filter(invoice => invoice.reviewedAt)
      .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
      .forEach((invoice, index) => order.set(invoice.id, index + 1))
    return order
  }, [contextualInvoices])
  const visibleInvoices = useMemo(
    () => contextualInvoices.filter(invoice =>
      (showExported || invoice.status !== 'exported')
      && (sqlFilter === 'all'
        || (sqlFilter === 'unchecked' ? !invoice.sqlVerification : invoice.sqlVerification?.status === sqlFilter)),
    ),
    [contextualInvoices, showExported, sqlFilter],
  )
  const sortedInvoices = useMemo(() => {
    if (!sortField) return visibleInvoices
    const factor = sortDirection === 'asc' ? 1 : -1
    return [...visibleInvoices].sort((a, b) => {
      if (sortField === 'date') return a.documentDate.localeCompare(b.documentDate) * factor
      if (sortField === 'supplier') return a.supplierName.localeCompare(b.supplierName, 'pt-PT') * factor
      return (a.totalAmount - b.totalAmount) * factor
    })
  }, [visibleInvoices, sortField, sortDirection])
  const totalPages = Math.max(1, Math.ceil(visibleInvoices.length / pageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex = (safeCurrentPage - 1) * pageSize
  const pagedInvoices = useMemo(
    () => sortedInvoices.slice(pageStartIndex, pageStartIndex + pageSize),
    [sortedInvoices, pageStartIndex, pageSize],
  )
  const pageItems = useMemo(
    () => paginationItems(safeCurrentPage, totalPages),
    [safeCurrentPage, totalPages],
  )
  const firstVisibleResult = visibleInvoices.length ? pageStartIndex + 1 : 0
  const lastVisibleResult = Math.min(pageStartIndex + pageSize, visibleInvoices.length)

  useEffect(() => {
    setCurrentPage(1)
  }, [clientId, showExported, monthFilter, supplierFilter, sqlFilter, pageSize, sortField, sortDirection])

  const toggleSort = (field: 'date' | 'supplier' | 'total') => {
    if (sortField === field) {
      setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const sortIndicator = (field: 'date' | 'supplier' | 'total') => {
    if (sortField !== field) return null
    return <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>
  }

  const sortAriaState = (field: 'date' | 'supplier' | 'total'): 'ascending' | 'descending' | 'none' =>
    sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'

  useEffect(() => {
    setCurrentPage(page => Math.min(page, totalPages))
  }, [totalPages])

  const selected = contextualInvoices.filter(invoice => invoice.selected && invoice.status === 'pending')
  const totals = selected.reduce((sum, invoice) => sum + invoice.totalAmount, 0)
  const verificationCounts = contextualInvoices.reduce((counts, invoice) => {
    const key = invoice.sqlVerification?.status ?? 'unchecked'
    counts[key] += 1
    return counts
  }, { confirmed: 0, possible: 0, missing: 0, unchecked: 0 })
  const rawPeriodLabel = monthFilter
    ? new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' })
      .format(new Date(`${monthFilter}-01T12:00:00`))
    : 'Todos os meses'
  const periodLabel = rawPeriodLabel.charAt(0).toUpperCase() + rawPeriodLabel.slice(1)

  const applySqlFilter = (filter: typeof sqlFilter) => {
    setSqlFilter(filter)
    if (filter === 'confirmed') setShowExported(true)
  }

  const persist = (next: PurchaseInvoice[]) => {
    setInvoices(next)
    if (!savePurchases(clientId, next)) setMessage('Sem espaço para guardar todas as faturas neste navegador.')
  }

  const importFile = async (file: File) => {
    try {
      const result = await parseEfaturaFile(file)
      mergeImported(result.invoices, result.ignored, 'Ficheiro e-Fatura importado')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível importar o ficheiro e-Fatura.')
    }
  }

  const inspectPurchaseFile = async (file: File) => {
    setMessage('A identificar colunas e formato do ficheiro…')
    setDetectedFile({ file, analysis: await analyzeFile(file) })
  }

  const suggestAccounts = (invoice: PurchaseInvoice): PurchaseInvoice => {
    let next = applySupplierModel(invoice, models[invoice.supplierNif])
    const category = detectCategory(next.supplierName, next.description)
    if (category) next = applyCategoryModel(next, categoryModels[category])
    if (vatRegime !== 'isento') next = applyAccountVat(next, accountVatMap)
    // A conta real do fornecedor, sincronizada do ERP Evolution (CnfTabLigCBL), é a fonte de verdade —
    // sobrepõe-se sempre a um modelo aprendido antigo, que pode ter ficado desatualizado/errado de
    // antes desta conta estar disponível.
    if (next.supplierNif) {
      const knownSupplier = masterData.suppliers.find(supplier => supplier.nif === next.supplierNif)
      if (knownSupplier?.account) next = { ...next, supplierAccount: knownSupplier.account }
    }
    const smart = suggestSmartRule(clientId, 'purchase', `${next.supplierName} ${next.description}`)
    if (smart) {
      next = {
        ...next,
        expenseAccount: next.expenseAccount || smart.outcome.expenseAccount || '',
        vatCode: next.vatCode || smart.outcome.vatCode || '',
        supplierAccount: next.supplierAccount || smart.outcome.supplierAccount || '',
        intelligence: !next.intelligence || smart.confidence > next.intelligence.confidence
          ? { confidence: smart.confidence, evidence: smart.evidence }
          : next.intelligence,
      }
    }
    return next
  }

  // As faturas já importadas não são reprocessadas automaticamente quando os modelos aprendidos
  // ou os fornecedores sincronizados mudam depois (ex: corrigir o NIF em falta) — este botão
  // reaplica as sugestões às pendentes sem tocar no que já foi preenchido manualmente.
  const reapplySuggestions = () => {
    let filled = 0
    let learnedFromHistory = 0
    let modelsChanged = false
    const nextModels = { ...models }
    const history = buildPurchaseHistoryIndex(invoices, [])
    const next = invoices.map(invoice => {
      if (!contextualInvoiceIds.has(invoice.id) || invoice.status !== 'pending') return invoice
      let suggested = suggestAccounts(invoice)
      const historical = suggestPurchaseFromHistory(invoice, history, masterData, vatRegime)
      if (historical) {
        const before = suggested
        suggested = applyPurchaseHistorySuggestion(suggested, historical)
        if (
          suggested.expenseAccount !== before.expenseAccount
          || suggested.vatCode !== before.vatCode
          || suggested.supplierAccount !== before.supplierAccount
        ) learnedFromHistory += 1
        modelsChanged = rememberHistorySuggestion(nextModels, invoice, historical) || modelsChanged
      }
      if (suggested.supplierAccount !== invoice.supplierAccount) filled += 1
      if (suggested.expenseAccount !== invoice.expenseAccount) filled += 1
      if (suggested.vatCode !== invoice.vatCode) filled += 1
      return suggested
    })
    if (modelsChanged) {
      setModels(nextModels)
      saveSupplierModels(clientId, nextModels)
    }
    persist(next)
    setMessage(filled
      ? `${filled} contas preenchidas/corrigidas${learnedFromHistory ? `; ${learnedFromHistory} faturas aprenderam com lançamentos anteriores do Primavera` : ''}.`
      : 'Nenhuma conta nova para sugerir.')
  }

  const mergeImported = (imported: PurchaseInvoice[], ignored: number, prefix: string) => {
    let automaticallyReady = 0
    const learned = imported.map(invoice => {
      const suggested = suggestAccounts({
        ...invoice,
        journal: defaultJournal,
        documentType: defaultDocument,
      })
      // Só pré-seleciona quando todos os campos fecham e o histórico já foi confirmado pelo
      // menos duas vezes. As restantes ficam preenchidas, mas aguardam revisão humana.
      const selected = isInvoiceReadyForExport(suggested, vatRegime)
        && (suggested.intelligence?.confidence ?? 0) >= 85
      if (selected) automaticallyReady += 1
      return { ...suggested, selected }
    })
    const merged = mergePurchases(invoices, learned)
    persist(merged.invoices)
    setMessage(`${prefix}: ${merged.added} novas, ${merged.duplicates} duplicadas e ${ignored} ignoradas${automaticallyReady ? `; ${automaticallyReady} prontas automaticamente` : ''}.`)
  }

  const fetchFromPortal = async (dateFrom: string, dateTo: string) => {
    if (!gatewayUrl.trim() || !companyCode.trim()) {
      setMessage('Configura primeiro o gateway e o código da empresa.')
      return
    }
    setFetchingEfatura(true)
    setMessage('A autenticar e a pesquisar no e‑Fatura…')
    try {
      const result = await fetchEfaturaMonth(gatewayUrl, companyCode, dateFrom, dateTo)
      const parsed = parseEfaturaPortalRows(result.rows)
      mergeImported(parsed.invoices, parsed.ignored, result.message)
      setShowEfatura(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível recolher no e-Fatura.')
    } finally {
      setFetchingEfatura(false)
    }
  }

  const updateInvoice = (next: PurchaseInvoice) => {
    persist(invoices.map(invoice => invoice.id === next.id ? next : invoice))
  }

  const validateInvoiceFromPurchases = (target: PurchaseInvoice, justification: string) => {
    const validated = applyManualValidation(target, justification)
    persist(invoices.map(invoice => invoice.id === target.id ? validated : invoice))
    setMessage(`Fatura ${target.documentNo} validada manualmente e marcada como lançada no Primavera.`)
  }

  // A importação nunca substitui nem remove faturas já existentes (evita reimportar duplicados),
  // por isso uma fatura anulada importada antes desta verificação existir só sai daqui.
  const removeInvoice = (invoice: PurchaseInvoice) => {
    const ok = window.confirm(`Remover a fatura ${invoice.documentNo} (${invoice.supplierName || 'sem fornecedor'})? Esta ação não pode ser desfeita.`)
    if (!ok) return
    persist(invoices.filter(item => item.id !== invoice.id))
  }

  // Aprende apenas com lançamentos explicitamente aprovados para exportação. Anteriormente o
  // modelo era alterado a cada tecla, o que memorizava valores incompletos e tornava as sugestões
  // instáveis. Confirmações repetidas aumentam a confiança; mudanças reduzem-na.
  const learnApprovedInvoices = (approved: PurchaseInvoice[]) => {
    const updatedAt = new Date().toISOString()
    const nextModels = { ...models }
    const nextCategoryModels = { ...categoryModels }
    const nextAccountVatMap = { ...accountVatMap }

    approved.forEach(invoice => {
      learnSmartRule(clientId, 'purchase', `${invoice.supplierName} ${invoice.description}`, {
        expenseAccount: invoice.expenseAccount,
        vatCode: invoice.vatCode,
        supplierAccount: invoice.supplierAccount,
        journal: invoice.journal,
        documentType: invoice.documentType,
      })

      if (invoice.supplierNif) {
        const existing = nextModels[invoice.supplierNif]
        const same = existing
          && existing.expenseAccount === invoice.expenseAccount
          && existing.vatCode === invoice.vatCode
          && existing.supplierAccount === invoice.supplierAccount
          && existing.journal === invoice.journal
          && existing.documentType === invoice.documentType
        nextModels[invoice.supplierNif] = {
          supplierNif: invoice.supplierNif,
          supplierName: invoice.supplierName,
          expenseAccount: invoice.expenseAccount,
          vatCode: invoice.vatCode,
          supplierAccount: invoice.supplierAccount,
          journal: invoice.journal,
          documentType: invoice.documentType,
          updatedAt,
          confirmations: same ? (existing.confirmations ?? 1) + 1 : 1,
          corrections: (existing?.corrections ?? 0) + (existing && !same ? 1 : 0),
        }
      }

      const category = detectCategory(invoice.supplierName, invoice.description)
      if (category && invoice.expenseAccount) {
        nextCategoryModels[category] = { category, expenseAccount: invoice.expenseAccount, updatedAt }
      }

      if (invoice.expenseAccount && invoice.vatCode) {
        nextAccountVatMap[invoice.expenseAccount] = {
          expenseAccount: invoice.expenseAccount,
          vatCode: invoice.vatCode,
          updatedAt,
        }
      }
    })

    setModels(nextModels)
    setCategoryModels(nextCategoryModels)
    setAccountVatMap(nextAccountVatMap)
    saveSupplierModels(clientId, nextModels)
    saveCategoryModels(clientId, nextCategoryModels)
    saveAccountVatMap(clientId, nextAccountVatMap)
  }

  const exportSelected = () => {
    // Aponta exatamente quais faturas falham (não só a primeira, como o texto de erro) para a
    // lista as destacar a vermelho — mais fácil de encontrar do que ler o número do documento na
    // mensagem e procurar a linha à mão.
    const invalidInvoices = selected.filter(invoice => !isInvoiceReadyForExport(invoice, vatRegime))
    if (!selected.length || invalidInvoices.length) {
      setExportErrorIds(new Set(invalidInvoices.map(invoice => invoice.id)))
      return setMessage(invalidInvoices.length > 1
        ? `${invalidInvoices.length} faturas por corrigir antes de exportar — assinaladas a vermelho na lista.`
        : validatePurchasesForExport(selected, vatRegime))
    }
    setExportErrorIds(new Set())
    learnApprovedInvoices(selected)
    const content = generatePurchasesTxt(selected, year, startNumber, vatRegime, masterData.vatRates)
    downloadPurchaseTxt(`compras_${clientId}_${year}.txt`, content)
    const exportedIds = new Set(selected.map(invoice => invoice.id))
    persist(invoices.map(invoice => exportedIds.has(invoice.id)
      ? { ...invoice, selected: false, status: 'exported', exportedAt: new Date().toISOString() }
      : invoice))
    setMessage(`${selected.length} faturas exportadas e marcadas como lançadas.`)
  }

  // PDF para enviar ao cliente a pedir as faturas que o e-Fatura mostra existirem mas que a
  // verificação ao Primavera não conseguiu confirmar na contabilidade.
  const exportUnconfirmedPdf = () => {
    const unconfirmed = invoices.filter(invoice =>
      invoice.sqlVerification?.status === 'missing'
      && (!monthFilter || invoice.documentDate.startsWith(monthFilter)),
    )
    if (!unconfirmed.length) {
      return setMessage(monthFilter
        ? `Não há faturas não confirmadas em ${monthFilter} para pedir ao cliente.`
        : 'Não há faturas não confirmadas para pedir ao cliente.')
    }
    exportUnconfirmedInvoicesPdf(invoices, clientName, monthFilter)
    setMessage(`PDF gerado com ${unconfirmed.length} faturas não confirmadas${monthFilter ? ` de ${monthFilter}` : ''}.`)
  }

  // Reverte faturas já lançadas para pendentes (ex: o TXT anterior foi gerado num formato que o
  // ERP Evolution rejeitou, ou foi importado por engano) — sem isto não há forma de as exportar de novo.
  const reopenExported = () => {
    const exportedCount = contextualInvoices.filter(invoice => invoice.status === 'exported').length
    if (!exportedCount) return setMessage('Não há faturas lançadas para reabrir.')
    const reopenedAt = new Date().toISOString()
    persist(invoices.map(invoice => contextualInvoiceIds.has(invoice.id) && invoice.status === 'exported'
      ? { ...invoice, status: 'pending', selected: true, exportedAt: undefined, sqlVerification: undefined, reopenedAt }
      : invoice))
    setMessage(`${exportedCount} faturas reabertas como pendentes.`)
  }

  const verifyInPrimavera = async () => {
    // O estado React só desativa o botão no render seguinte. O ref bloqueia imediatamente um
    // segundo clique e evita várias consultas pesadas em paralelo.
    if (checkingSqlRef.current) return
    // Verifica também as que foram marcadas localmente ao criar um TXT: criar o ficheiro não
    // prova que ele chegou a ser importado no ERP, e esta consulta serve precisamente para isso.
    const candidates = contextualInvoices
    if (!candidates.length) return setMessage('Não há faturas para verificar.')
    if (!gatewayUrl.trim() || !companyCode.trim()) return setMessage('Configura primeiro a ligação ao Primavera.')
    if (!extensionToken.trim()) return setMessage('Configura primeiro o token da extensão local.')

    checkingSqlRef.current = true
    setCheckingSql(true)
    setMessage('A verificar as faturas na contabilidade do Primavera…')
    try {
      const connector = new PrimaveraGatewayConnector(gatewayUrl)
      const matches = new Map<string, ReturnType<typeof matchPurchaseInLedger>>()
      const dates = candidates.map(invoice => invoice.documentDate).sort()
      const from = new Date(`${dates[0]}T00:00:00Z`)
      const to = new Date(`${dates[dates.length - 1]}T00:00:00Z`)
      // Todas as regras de reconciliação usam no máximo 45 dias em torno da fatura. A consulta
      // anterior lia mais seis meses para sugestões históricas e, na COFAFE, devolvia 171 mil
      // movimentos. Mantém só a janela necessária para confirmar as compras; as sugestões já
      // aprendidas continuam disponíveis nos modelos guardados.
      from.setUTCDate(from.getUTCDate() - 45)
      to.setUTCDate(to.getUTCDate() + 45)
      // Uma única consulta lê TODOS os movimentos do período (não só contas de fornecedor): a
      // liquidação de uma compra por vezes vai direta ao banco, outras vezes passa pela 27 em
      // vez da 22. Filtrar por conta aqui deixaria essas faturas por confirmar.
      const response = await connector.syncPurchaseLedger(
        companyCode, sql, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), extensionToken,
      )
      if (!response.success || !response.data) throw new Error(response.message)
      // Nota: as regras por empresa (CTT, Via Verde, Refeições) usam o clientId (identificador da
      // empresa nesta app, ex. "jactigas") — companyCode é o código da empresa dentro da própria
      // Primavera (settings.primaveraCompanyCode), usado só na ligação SQL, e não corresponde ao
      // mesmo valor.
      const monthlyConsolidated = candidates.filter(invoice => hasMonthlyConsolidatedPosting(clientId, invoice.supplierNif))
      const perInvoice = candidates.filter(invoice =>
        !hasMonthlyConsolidatedPosting(clientId, invoice.supplierNif)
        || prefersIndividualPurchaseMatch(clientId, invoice.supplierNif),
      )
      perInvoice.forEach(invoice => {
        const normalizedNif = invoice.supplierNif.replace(/\D/g, '')
        const supplierForNif = normalizedNif
          ? masterData.suppliers.find(supplier => (supplier.nif ?? '').replace(/\D/g, '') === normalizedNif)
          : undefined
        matches.set(invoice.id, matchPurchaseInLedger(
          invoice,
          response.data!.movements,
          supplierForNif?.account,
          supplierForNif?.code,
        ))
      })
      // Cada fatura acima foi comparada isoladamente — nada impede que duas faturas com o mesmo
      // valor tenham acabado "casadas" com a mesma linha do razão. Resolve esses conflitos antes
      // de qualquer fallback (Via Verde, mensal, lote) decidir com base num estado errado.
      resolveMovementConflicts(perInvoice.map(invoice => invoice.id), matches)
      // A contabilização da Via Verde passou a ser feita por fatura. Tenta primeiro o match
      // individual, limitado ao respetivo grupo de NIF; a regra mensal só recebe as que falharam.
      const viaVerdeIndividual = monthlyConsolidated.filter(invoice =>
        prefersIndividualPurchaseMatch(clientId, invoice.supplierNif)
        && matches.get(invoice.id)?.kind !== 'confirmed',
      )
      matchViaVerdeIndividualPurchases(clientId, viaVerdeIndividual, response.data!.movements)
        .forEach((match, invoiceId) => matches.set(invoiceId, match))
      const monthlyFallback = monthlyConsolidated.filter(invoice => matches.get(invoice.id)?.kind !== 'confirmed')
      matchMonthlyConsolidatedPurchases(clientId, monthlyFallback, response.data!.movements)
        .forEach((match, invoiceId) => {
          const existing = matches.get(invoiceId)
          const existingRank = existing?.kind === 'confirmed' ? 2 : existing?.kind === 'possible' ? 1 : 0
          const fallbackRank = match.kind === 'confirmed' ? 2 : match.kind === 'possible' ? 1 : 0
          if (!existing || fallbackRank > existingRank) matches.set(invoiceId, match)
        })
      // Último recurso: só para quem continua "missing" depois das verificações acima.
      const stillMissing = candidates.filter(invoice => (matches.get(invoice.id) ?? { kind: 'missing' }).kind === 'missing')
      matchAgainstLumpAccountLines(clientId, stillMissing, response.data!.movements)
        .forEach((match, invoiceId) => matches.set(invoiceId, match))

      const checkedAt = new Date().toISOString()
      let confirmed = 0
      let possible = 0
      let missing = 0
      const checkedInvoices = invoices.map(invoice => {
        let match = matches.get(invoice.id)
        if (!match) return invoice
        // SAF-T e validação manual são mais fiáveis do que uma reverificação SQL comum — uma
        // reverificação nunca deve desfazer uma dessas confirmações anteriores.
        const historical = invoice.sqlVerification?.source === 'saft' || invoice.sqlVerification?.source === 'manual'
          ? invoice.sqlVerification
          : null
        const matchRank = match.kind === 'confirmed' ? 2 : match.kind === 'possible' ? 1 : 0
        const historicalRank = historical?.status === 'confirmed' ? 2 : historical?.status === 'possible' ? 1 : 0
        const useHistorical = Boolean(historical && historicalRank > matchRank)
        if (historical && useHistorical) {
          match = {
            kind: historical.status,
            evidence: historical.evidence,
            lowConfidence: historical.lowConfidence,
            amountDifference: historical.amountDifference,
            directBank: historical.directBank,
          }
        }
        if (match.kind === 'confirmed') confirmed += 1
        else if (match.kind === 'possible') possible += 1
        else missing += 1
        const verificationSource: 'sql' | 'saft' | 'manual' = useHistorical && historical ? historical.source ?? 'saft' : 'sql'
        return {
          ...invoice,
          supplierAccount: (match.kind === 'confirmed' || Boolean(match.amountDifference)) && isPayableAccount(match.movement?.account)
            ? match.movement!.account!
            : invoice.supplierAccount,
          selected: match.kind === 'confirmed' ? false : invoice.selected,
          status: match.kind === 'confirmed' ? 'exported' as const : invoice.status,
          sqlVerification: {
            status: match.kind,
            checkedAt: useHistorical && historical ? historical.checkedAt : checkedAt,
            evidence: match.evidence,
            movementId: useHistorical && historical ? historical.movementId : match.movement?.id,
            source: verificationSource,
            lowConfidence: useHistorical && historical ? historical.lowConfidence : match.lowConfidence,
            amountDifference: useHistorical && historical ? historical.amountDifference : match.amountDifference,
            directBank: useHistorical && historical ? historical.directBank : match.directBank,
            posting: useHistorical && historical ? historical.posting : match.posting,
            manualReview: useHistorical && historical ? historical.manualReview : undefined,
          },
        }
      })
      let historySuggested = 0
      let modelsChanged = false
      const nextModels = { ...models }
      const history = buildPurchaseHistoryIndex(checkedInvoices, response.data.movements)
      const next = checkedInvoices.map(invoice => {
        if (invoice.status !== 'pending') return invoice
        const historical = suggestPurchaseFromHistory(
          invoice,
          history,
          masterData,
          vatRegime,
        )
        if (!historical) return invoice
        const suggested = applyPurchaseHistorySuggestion(invoice, historical)
        if (suggested === invoice) return invoice
        historySuggested += 1
        modelsChanged = rememberHistorySuggestion(nextModels, invoice, historical) || modelsChanged
        return suggested
      })
      if (modelsChanged) {
        setModels(nextModels)
        saveSupplierModels(clientId, nextModels)
      }
      persist(next)
      setShowExported(true)
      setMessage(
        `Verificação concluída: ${confirmed} confirmadas, ${possible} para rever e ${missing} sem correspondência segura`
        + `${historySuggested ? `; contas sugeridas pelo histórico em ${historySuggested} faturas` : ''}.`,
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Não foi possível verificar as faturas no Primavera.'
      setMessage(/TRY_CONVERT.*not a recognized built-in function/i.test(detail)
        ? 'A extensão local instalada está desatualizada para este SQL Server. Descarrega novamente o instalador nas Configurações e executa o INSTALAR.bat com o mesmo token.'
        : detail)
    } finally {
      checkingSqlRef.current = false
      setCheckingSql(false)
    }
  }

  const applyDefaultJournal = (value: string) => {
    onDefaultJournalChange(value)
    persist(invoices.map(invoice =>
      (!invoice.journal.trim() || invoice.journal === defaultJournal) ? { ...invoice, journal: value } : invoice,
    ))
  }

  const applyDefaultDocument = (value: string) => {
    onDefaultDocumentChange(value)
    persist(invoices.map(invoice =>
      (!invoice.documentType.trim() || invoice.documentType === defaultDocument) ? { ...invoice, documentType: value } : invoice,
    ))
  }

  return (
    <section className="module-page purchases-page">
      <header className="purchase-workspace-heading">
        <div>
          <span>Compras e contabilização</span>
          <h2>Documentos de fornecedores</h2>
          <p>Importação, conferência e exportação segura para o Primavera.</p>
        </div>
        <strong>{periodLabel}</strong>
      </header>

      <div className="purchase-summary-strip" aria-label="Resumo das compras no período">
        <article>
          <small>Documentos no período</small>
          <strong>{contextualInvoices.length}</strong>
          <span>{periodLabel}</span>
        </article>
        <article className="is-confirmed">
          <small>Confirmados no Primavera</small>
          <strong>{verificationCounts.confirmed}</strong>
          <span>{contextualInvoices.length ? Math.round((verificationCounts.confirmed / contextualInvoices.length) * 100) : 0}% do período</span>
        </article>
        <article className="needs-review">
          <small>Exigem atenção</small>
          <strong>{verificationCounts.possible + verificationCounts.missing + verificationCounts.unchecked}</strong>
          <span>{verificationCounts.possible} a rever · {verificationCounts.missing} em falta</span>
        </article>
        <article className="is-selected">
          <small>Preparados para TXT</small>
          <strong>{selected.length}</strong>
          <span>{totals.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € selecionados</span>
        </article>
      </div>

      <div className="purchase-panel">
        <div className="purchase-overview">
          <div className="purchase-toolbar-options">
            <div className="purchase-filter-fields">
              <label><span>Diário</span><input list="purchase-journals" value={defaultJournal} onChange={event => applyDefaultJournal(event.target.value)} /></label>
              <label><span>Documento</span><input list="purchase-documents" value={defaultDocument} onChange={event => applyDefaultDocument(event.target.value)} /></label>
              <label><span>Mês</span><select aria-label="Filtrar por mês" value={monthFilter} onChange={event => setMonthFilter(event.target.value)}>
                <option value="">Todos os meses</option>
                {months.map(month => <option key={month} value={month}>{month}</option>)}
              </select></label>
              <label className="supplier-filter-field"><span>Fornecedor</span><select className="supplier-filter" aria-label="Filtrar por fornecedor" value={supplierFilter} onChange={event => setSupplierFilter(event.target.value)}>
                <option value="">Todos os fornecedores</option>
                {suppliers.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select></label>
            </div>
            <label className="inline-check show-exported-check"><input type="checkbox" checked={showExported} onChange={event => setShowExported(event.target.checked)} /> Incluir lançadas</label>
            {(monthFilter || supplierFilter || sqlFilter !== 'all' || showExported) && (
              <button className="purchase-clear-filters" type="button" onClick={() => {
                setMonthFilter('')
                setSupplierFilter('')
                setSqlFilter('all')
                setShowExported(false)
              }}>Limpar filtros</button>
            )}
          </div>

          <div className="purchase-context-summary" aria-label={`Estado dos documentos de ${periodLabel}`}>
            <div className="purchase-context-label">
              <strong>{periodLabel}</strong>
              <span>{contextualInvoices.length} documento{contextualInvoices.length === 1 ? '' : 's'}</span>
            </div>
            <div className="sql-verification-summary">
              <button className={sqlFilter === 'all' ? 'active' : ''} onClick={() => applySqlFilter('all')}>Todos · {contextualInvoices.length}</button>
              <button className={`confirmed ${sqlFilter === 'confirmed' ? 'active' : ''}`} onClick={() => applySqlFilter('confirmed')}>Confirmados · {verificationCounts.confirmed}</button>
              <button className={`possible ${sqlFilter === 'possible' ? 'active' : ''}`} onClick={() => applySqlFilter('possible')}>A rever · {verificationCounts.possible}</button>
              <button className={`missing ${sqlFilter === 'missing' ? 'active' : ''}`} onClick={() => applySqlFilter('missing')}>Em falta · {verificationCounts.missing}</button>
              <button className={`unchecked ${sqlFilter === 'unchecked' ? 'active' : ''}`} onClick={() => applySqlFilter('unchecked')}>Por verificar · {verificationCounts.unchecked}</button>
            </div>
          </div>
        </div>

        <div className="purchase-actionbar">
          <div className="purchase-main-actions">
            <button className="purchase-primary-action" onClick={() => setShowEfatura(true)}><PurchaseIcon name="import" />Importar do e‑Fatura</button>
            <label className="button-like secondary-upload">
              <PurchaseIcon name="upload" />Importar ficheiro
              <input type="file" accept=".csv,.xlsx,.xls,.xlsm" onChange={event => {
                const file = event.target.files?.[0]
                if (file) inspectPurchaseFile(file)
                event.target.value = ''
              }} />
            </label>
            <button className="secondary" onClick={verifyInPrimavera} disabled={checkingSql}>
              <PurchaseIcon name="search" />{checkingSql ? 'A verificar…' : 'Verificar no Primavera'}
            </button>
          </div>
          <div className="purchase-secondary-actions">
            <button className="secondary" onClick={() => persist(invoices.map(invoice => contextualInvoiceIds.has(invoice.id)
              ? { ...invoice, selected: invoice.status === 'pending' }
              : invoice))}>Selecionar pendentes</button>
            <button
              className="secondary"
              title="Seleciona só as faturas prontas (contas preenchidas) e já marcadas como conferidas"
              onClick={() => persist(invoices.map(invoice => ({
                ...invoice,
                selected: contextualInvoiceIds.has(invoice.id)
                  ? invoice.status === 'pending' && isInvoiceReadyForExport(invoice, vatRegime) && Boolean(invoice.reviewedAt)
                  : invoice.selected,
              })))}
            >Selecionar prontas</button>
            <button className="secondary" onClick={reapplySuggestions}>Sugerir contas</button>
            <button className="secondary" onClick={reopenExported}>Reabrir lançadas</button>
            <button className="secondary" onClick={exportUnconfirmedPdf}><PurchaseIcon name="file" />Pedir faturas ao cliente (PDF)</button>
            <span className="purchase-selection-summary">
              <strong>{selected.length}</strong> selecionada{selected.length === 1 ? '' : 's'}
              <b>{totals.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</b>
            </span>
            <button className="purchase-export-action" onClick={exportSelected} disabled={!selected.length}><PurchaseIcon name="file" />Criar TXT para o Primavera</button>
          </div>
        </div>
      </div>

      <div className="purchase-list-panel">
        <header className="purchase-list-heading">
          <div>
            <h3>Documentos de compra</h3>
            <p>Confirme os dados contabilísticos e selecione apenas os documentos prontos para exportar.</p>
          </div>
          <span><b>{visibleInvoices.length}</b> {visibleInvoices.length === 1 ? 'documento' : 'documentos'}</span>
        </header>
        {message && <div className={`notice ${isPurchaseErrorMessage(message) ? 'error' : ''}`}>{message}</div>}

        <div className="table-wrap purchase-table-wrap">
          <table className="purchase-table">
            <thead>
              <tr>
                <th></th><th>Estado</th><th>Conferida</th>
                <th className="sortable" aria-sort={sortAriaState('date')} onClick={() => toggleSort('date')}>Data{sortIndicator('date')}</th>
                <th>Documento</th><th>NIF</th>
                <th className="sortable" aria-sort={sortAriaState('supplier')} onClick={() => toggleSort('supplier')}>Fornecedor{sortIndicator('supplier')}</th>
                <th>Confiança</th><th>Base</th><th>IVA</th>
                <th className="sortable" aria-sort={sortAriaState('total')} onClick={() => toggleSort('total')}>Total{sortIndicator('total')}</th>
                <th>Conta gasto</th>{vatRegime !== 'isento' && <th>Código IVA</th>}<th>Conta fornecedor</th><th>Diário</th><th>Tipo doc.</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pagedInvoices.map(invoice => (
                <PurchaseInvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  vatRegime={vatRegime}
                  masterData={masterData}
                  reviewOrder={reviewOrder.get(invoice.id)}
                  hasExportError={exportErrorIds.has(invoice.id) && !isInvoiceReadyForExport(invoice, vatRegime)}
                  onChange={updateInvoice}
                  onValidate={validateInvoiceFromPurchases}
                  onRemove={removeInvoice}
                />
              ))}
              {!visibleInvoices.length && <tr><td colSpan={vatRegime === 'isento' ? 16 : 17} className="empty-state">Importa um ficheiro CSV ou Excel exportado do e‑Fatura.</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="purchase-pagination">
          <p>Mostrando <strong>{firstVisibleResult} a {lastVisibleResult}</strong> de <strong>{visibleInvoices.length}</strong> resultados</p>
          <label>
            <span className="sr-only">Resultados por página</span>
            <select aria-label="Resultados por página" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>
              <option value={30}>30 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>
          </label>
          <nav aria-label="Paginação das compras">
            <button type="button" className="pagination-direction" disabled={safeCurrentPage === 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}>Anterior</button>
            {pageItems.map((item, index) => item === 'ellipsis'
              ? <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
              : <button
                  type="button"
                  key={item}
                  className={`pagination-page ${item === safeCurrentPage ? 'active' : ''}`}
                  aria-current={item === safeCurrentPage ? 'page' : undefined}
                  aria-label={`Página ${item}`}
                  onClick={() => setCurrentPage(item)}
                >{item}</button>)}
            <button type="button" className="pagination-direction" disabled={safeCurrentPage === totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>Próximo</button>
          </nav>
        </footer>
      </div>
      <datalist id="purchase-accounts">{masterData.accounts.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="purchase-journals">{masterData.journals.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="purchase-documents">{masterData.documents.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="purchase-payment-accounts">
        {masterData.accounts.filter(item => item.code.startsWith('11') || item.code.startsWith('12'))
          .map(item => <option key={item.code} value={item.code}>{item.description}</option>)}
      </datalist>
      {showEfatura && (
        <EfaturaFetchDialog
          defaultYear={year}
          loading={fetchingEfatura}
          onClose={() => setShowEfatura(false)}
          onFetch={fetchFromPortal}
        />
      )}
      {detectedFile && (
        <FilePreviewDialog
          analysis={detectedFile.analysis}
          canConfirm={detectedFile.analysis.kind === 'efatura'}
          onCancel={() => setDetectedFile(null)}
          onConfirm={() => { const pending = detectedFile; setDetectedFile(null); importFile(pending.file) }}
        />
      )}
    </section>
  )
}
