import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Account } from '../../core/master-data'
import { PrimaveraGatewayConnector } from '../../core/primavera'
import { BankImportValidationModal } from './BankImportValidationModal'
import { BankFileFormat, parseBankFile } from './bank-parser'
import { countDuplicates, loadBankingState, mergeMovements, openingBalanceKey, refreshBankingStateFromServer, removeImportBatch, saveBankingState } from './bank-storage'
import { MovementColumn, SortBy } from './MovementColumn'
import { applyMatch, findExactMatches, selectionDifference, undoMatch } from './reconciliation-engine'
import { BankMovement, ImportBatch, ReconciliationMatch } from './types'
import { detectMovementAnomalies, findAdvancedMatches, findGroupMatches } from './reconciliation-intelligence'
import { mergeSaftMovements, parseSaftForBanking } from './saft-reconciliation'
import { learnSmartRule } from '../../core/smart-rules'
import { useFeedback } from '../../ui/feedback/FeedbackCenter'
import { analyzeFile, FileAnalysis } from '../../core/file-intelligence'
import { FilePreviewDialog } from '../../ui/components/FilePreviewDialog'
import './banking.css'

function sumAmount(movements: BankMovement[]) {
  return movements.reduce((total, item) => total + item.amount, 0)
}

function formatEuro(value: number) {
  return `${value.toFixed(2)} €`
}

type Props = {
  clientId: string
  accounts: Account[]
  gatewayUrl: string
  companyCode: string
  extensionToken: string
  sqlServer: string
  sqlDatabase: string
  sqlUser: string
  sqlPassword: string
  account: string
  month: string
  onAccountChange: (value: string) => void
  onMonthChange: (value: string) => void
}

export function monthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const dateFrom = `${month}-01`
  const lastDay = new Date(year, monthNumber, 0).getDate()
  const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`
  return { dateFrom, dateTo, year }
}

export function BankingPage({
  clientId, accounts, gatewayUrl, companyCode, extensionToken, sqlServer, sqlDatabase, sqlUser, sqlPassword,
  account, month, onAccountChange, onMonthChange,
}: Props) {
  const { notify } = useFeedback()
  const initial = loadBankingState(clientId)
  const [movements, setMovements] = useState(initial.movements)
  const [matches, setMatches] = useState(initial.matches)
  // Refs espelham o estado mais recente de forma síncrona: funções assíncronas (importFile,
  // fetchLedger) lêem-nas só depois do await terminar, para nunca basear um merge num "movements"
  // já desatualizado se outra importação tiver persistido entretanto (evita perder linhas).
  const movementsRef = useRef(movements)
  const matchesRef = useRef(matches)
  const [fetchingLedger, setFetchingLedger] = useState(false)
  const [importingSaft, setImportingSaft] = useState(false)
  const [tolerance, setTolerance] = useState(5)
  const [bankFileFormat, setBankFileFormat] = useState<BankFileFormat>('signed_amount')
  const [selectedBank, setSelectedBank] = useState<Set<string>>(new Set())
  const [selectedAccounting, setSelectedAccounting] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [bankOpeningBalances, setBankOpeningBalances] = useState(initial.bankOpeningBalances ?? {})
  const [accountingOpeningBalances, setAccountingOpeningBalances] = useState(initial.accountingOpeningBalances ?? {})
  const [bankClosingBalanceChecks, setBankClosingBalanceChecks] = useState(initial.bankClosingBalanceChecks ?? {})
  const [importBatches, setImportBatches] = useState(initial.importBatches ?? [])
  const bankOpeningBalancesRef = useRef(bankOpeningBalances)
  const accountingOpeningBalancesRef = useRef(accountingOpeningBalances)
  const bankClosingBalanceChecksRef = useRef(bankClosingBalanceChecks)
  const importBatchesRef = useRef(importBatches)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [viewingMatch, setViewingMatch] = useState<ReconciliationMatch | null>(null)
  const [pendingImport, setPendingImport] = useState<{
    fileName: string
    totalRows: number
    movements: BankMovement[]
    importBatchId: string
  } | null>(null)
  const [detectedFile, setDetectedFile] = useState<{ file: File; analysis: FileAnalysis } | null>(null)

  useEffect(() => {
    if (!message) return
    notify({ kind: /não|erro|diferença|cancelad|sem espaço/i.test(message) ? 'warning' : 'success', title: 'Reconciliação bancária', detail: message })
  }, [message, notify])

  useEffect(() => {
    let cancelled = false
    refreshBankingStateFromServer(clientId).then(remote => {
      if (cancelled || !remote) return
      movementsRef.current = remote.movements
      matchesRef.current = remote.matches
      bankOpeningBalancesRef.current = remote.bankOpeningBalances ?? {}
      accountingOpeningBalancesRef.current = remote.accountingOpeningBalances ?? {}
      bankClosingBalanceChecksRef.current = remote.bankClosingBalanceChecks ?? {}
      importBatchesRef.current = remote.importBatches ?? []
      setMovements(remote.movements)
      setMatches(remote.matches)
      setBankOpeningBalances(remote.bankOpeningBalances ?? {})
      setAccountingOpeningBalances(remote.accountingOpeningBalances ?? {})
      setBankClosingBalanceChecks(remote.bankClosingBalanceChecks ?? {})
      setImportBatches(remote.importBatches ?? [])
    })
    return () => { cancelled = true }
  }, [clientId])

  const accountOptions = useMemo(() => accounts.filter(item => item.code.startsWith('12')), [accounts])
  const accountMovements = movements.filter(item => item.account === account)

  const { dateFrom: periodFrom, dateTo: periodTo } = useMemo(() => monthRange(month), [month])
  // Saldos usam só o período exato (o saldo de abertura já contabiliza tudo antes disso). Mas a
  // lista mostrada inclui também pendentes de meses anteriores que ainda não foram reconciliados
  // — um cheque emitido em janeiro só compensado em fevereiro não deve desaparecer da vista.
  const periodMovements = accountMovements.filter(item => item.date >= periodFrom && item.date <= periodTo)
  const displayMovements = accountMovements.filter(item =>
    (item.status === 'pending' && item.date <= periodTo)
    || (item.status === 'reconciled' && item.date >= periodFrom && item.date <= periodTo)
  )
  const difference = selectionDifference(displayMovements, Array.from(selectedBank), Array.from(selectedAccounting))
  const intelligentMatches = useMemo(() => findAdvancedMatches(displayMovements, tolerance), [displayMovements, tolerance])
  const groupMatches = useMemo(() => findGroupMatches(displayMovements, tolerance), [displayMovements, tolerance])
  const anomalies = useMemo(() => detectMovementAnomalies(displayMovements), [displayMovements])

  const balanceKey = openingBalanceKey(account, month)
  const bankOpeningBalance = bankOpeningBalances[balanceKey] ?? 0
  const bankClosingBalance = bankOpeningBalance + sumAmount(periodMovements.filter(item => item.source === 'bank'))
  const accountingOpeningBalance = accountingOpeningBalances[balanceKey] ?? null
  const accountingClosingBalance = accountingOpeningBalance === null
    ? null
    : accountingOpeningBalance + sumAmount(periodMovements.filter(item => item.source === 'accounting'))
  const balancesMatch = accountingClosingBalance !== null && Math.abs(bankClosingBalance - accountingClosingBalance) < 0.01
  const bankClosingBalanceCheck = bankClosingBalanceChecks[balanceKey] ?? null
  const closingCheckMatches = bankClosingBalanceCheck !== null && Math.abs(bankClosingBalance - bankClosingBalanceCheck) < 0.01
  const accountBatches = importBatches.filter(batch => batch.account === account)
  const pendingImportDuplicateIds = useMemo(() => {
    if (!pendingImport) return new Set<string>()
    const existingIds = new Set(movements.map(item => item.id))
    return new Set(pendingImport.movements.filter(item => existingIds.has(item.id)).map(item => item.id))
  }, [pendingImport, movements])

  const persist = (
    nextMovements: BankMovement[],
    nextMatches = matchesRef.current,
    nextBankOpeningBalances = bankOpeningBalancesRef.current,
    nextAccountingOpeningBalances = accountingOpeningBalancesRef.current,
    nextBankClosingBalanceChecks = bankClosingBalanceChecksRef.current,
    nextImportBatches = importBatchesRef.current,
  ) => {
    movementsRef.current = nextMovements
    matchesRef.current = nextMatches
    bankOpeningBalancesRef.current = nextBankOpeningBalances
    accountingOpeningBalancesRef.current = nextAccountingOpeningBalances
    bankClosingBalanceChecksRef.current = nextBankClosingBalanceChecks
    importBatchesRef.current = nextImportBatches
    setMovements(nextMovements)
    setMatches(nextMatches)
    setBankOpeningBalances(nextBankOpeningBalances)
    setAccountingOpeningBalances(nextAccountingOpeningBalances)
    setBankClosingBalanceChecks(nextBankClosingBalanceChecks)
    setImportBatches(nextImportBatches)
    if (!saveBankingState(clientId, {
      movements: nextMovements,
      matches: nextMatches,
      bankOpeningBalances: nextBankOpeningBalances,
      accountingOpeningBalances: nextAccountingOpeningBalances,
      bankClosingBalanceChecks: nextBankClosingBalanceChecks,
      importBatches: nextImportBatches,
    })) {
      setMessage('Sem espaço para guardar toda a reconciliação neste navegador.')
    }
  }

  const setBankOpening = (value: number) => {
    persist(movementsRef.current, matchesRef.current, { ...bankOpeningBalancesRef.current, [balanceKey]: value })
  }

  const setBankClosingCheck = (value: number) => {
    persist(
      movementsRef.current, matchesRef.current, bankOpeningBalancesRef.current, accountingOpeningBalancesRef.current,
      { ...bankClosingBalanceChecksRef.current, [balanceKey]: value },
    )
  }

  const cancelImportBatch = (batchId: string) => {
    const result = removeImportBatch(movementsRef.current, batchId)
    const nextBatches = importBatchesRef.current.filter(batch => batch.id !== batchId)
    persist(result.movements, matchesRef.current, bankOpeningBalancesRef.current, accountingOpeningBalancesRef.current, bankClosingBalanceChecksRef.current, nextBatches)
    setMessage(
      `Importação anulada: ${result.removedCount} movimentos removidos.`
      + (result.keptReconciledCount ? ` ${result.keptReconciledCount} já reconciliados foram mantidos.` : '')
    )
  }

  const importFile = async (file: File, source: 'bank' | 'accounting', detectedFormat = bankFileFormat) => {
    if (!account) return setMessage('Seleciona primeiro uma conta 12.')
    const importBatchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { movements: imported, totalRows, skipped } = await parseBankFile(file, source, account, detectedFormat, importBatchId)
    const skipParts = [
      skipped.noDate && `${skipped.noDate} sem data`,
      skipped.noDescription && `${skipped.noDescription} sem descrição`,
      skipped.noAmount && `${skipped.noAmount} sem valor`,
    ].filter(Boolean)
    // Importar um extrato bancário pelo ficheiro errado (ou com uma linha mal lida) não tem forma
    // fácil de detetar antes de já estar misturado com os outros movimentos — por isso pedimos
    // confirmação explícita do saldo antes de aceitar (a importação de contabilidade/razão, que vem
    // sempre da mesma fonte fiável, continua direta).
    if (source === 'bank') {
      setPendingImport({ fileName: file.name, totalRows, movements: imported, importBatchId })
      if (skipParts.length) setMessage(`Linhas ignoradas no ficheiro: ${skipParts.join(', ')}.`)
      return
    }
    const before = movementsRef.current
    const merged = mergeMovements(before, imported)
    const addedCount = merged.length - before.length
    const duplicates = imported.length - addedCount
    const detail = [
      skipParts.length && `ignoradas: ${skipParts.join(', ')}`,
      duplicates > 0 && `${duplicates} já importadas antes`,
    ].filter(Boolean).join('; ')
    const batch: ImportBatch = {
      id: importBatchId, account, source, fileName: file.name,
      importedAt: new Date().toISOString(), movementCount: addedCount,
    }
    persist(
      merged, matchesRef.current, bankOpeningBalancesRef.current, accountingOpeningBalancesRef.current,
      bankClosingBalanceChecksRef.current, addedCount ? [batch, ...importBatchesRef.current] : importBatchesRef.current,
    )
    setMessage(
      `Ficheiro com ${totalRows} linhas: ${addedCount} movimentos novos de contabilidade.`
      + (detail ? ` (${detail})` : '')
    )
  }

  const inspectBankFile = async (file: File) => {
    setMessage('A identificar o formato do ficheiro…')
    const analysis = await analyzeFile(file)
    setDetectedFile({ file, analysis })
  }

  const confirmPendingImport = (nextOpeningBalance: number, nextClosingBalanceCheck: number) => {
    if (!pendingImport) return
    const before = movementsRef.current
    const merged = mergeMovements(before, pendingImport.movements)
    const addedCount = merged.length - before.length
    const duplicates = pendingImport.movements.length - addedCount
    const batch: ImportBatch = {
      id: pendingImport.importBatchId, account, source: 'bank', fileName: pendingImport.fileName,
      importedAt: new Date().toISOString(), movementCount: addedCount,
    }
    persist(
      merged, matchesRef.current,
      { ...bankOpeningBalancesRef.current, [balanceKey]: nextOpeningBalance },
      accountingOpeningBalancesRef.current,
      { ...bankClosingBalanceChecksRef.current, [balanceKey]: nextClosingBalanceCheck },
      addedCount ? [batch, ...importBatchesRef.current] : importBatchesRef.current,
    )
    setMessage(
      `Ficheiro com ${pendingImport.totalRows} linhas: ${addedCount} movimentos novos de banco aceites.`
      + (duplicates > 0 ? ` (${duplicates} já importados antes)` : '')
    )
    setPendingImport(null)
  }

  const cancelPendingImport = () => {
    setPendingImport(null)
    setMessage('Importação cancelada — nenhum movimento foi adicionado.')
  }

  const fetchLedger = async () => {
    if (!account) return setMessage('Seleciona primeiro uma conta 12.')
    if (!extensionToken.trim()) return setMessage('Define o token da extensão nas Configurações.')
    const { dateFrom, dateTo, year } = monthRange(month)
    setFetchingLedger(true)
    setMessage(`A ler os movimentos da conta ${account} em ${month}…`)
    const result = await new PrimaveraGatewayConnector(gatewayUrl).syncLedger(
      companyCode,
      { server: sqlServer, database: sqlDatabase, year, user: sqlUser, password: sqlPassword },
      account,
      dateFrom,
      dateTo,
      extensionToken,
    )
    if (result.success && result.data) {
      const importedAt = new Date().toISOString()
      const imported: BankMovement[] = result.data.movements.map(item => {
        const nature = item.debit > 0 ? 'D' as const : 'C' as const
        const amount = nature === 'D' ? item.debit : -item.credit
        return {
          id: `movement-accounting-${item.id}`,
          source: 'accounting',
          account,
          date: item.date,
          description: item.description,
          reference: item.reference,
          amount,
          nature,
          status: 'pending',
          importedAt,
        }
      })
      // Substitui os pendentes de contabilidade já importados para esta conta/período em vez de
      // os acumular: evita duplicados ao reimportar a mesma razão (ex: depois de uma correção).
      const withoutStalePending = movementsRef.current.filter(item => !(
        item.source === 'accounting' && item.account === account && item.status === 'pending'
        && item.date >= dateFrom && item.date <= dateTo
      ))
      persist(mergeMovements(withoutStalePending, imported), matchesRef.current, bankOpeningBalancesRef.current, {
        ...accountingOpeningBalancesRef.current,
        [balanceKey]: result.data.openingBalance ?? 0,
      })
      setMessage(`${imported.length} movimentos lidos do ERP Evolution para ${month}.`)
    } else {
      setMessage(
        /RPC desconhecido:\s*syncLedger/i.test(result.message)
          ? 'A extensão local está desatualizada. Em Configurações, descarrega o instalador e volta a correr o INSTALAR.bat; a extensão reinicia em segundo plano.'
          : result.message,
      )
    }
    setFetchingLedger(false)
  }

  const importSaft = async (file: File) => {
    if (!account) return setMessage('Seleciona primeiro a conta bancária a enriquecer.')
    setImportingSaft(true)
    setMessage('A ler o SAF-T e a enriquecer os movimentos da conta 12…')
    try {
      const parsed = await parseSaftForBanking(file, account, month)
      const merged = mergeSaftMovements(movementsRef.current, parsed.movements)
      const nextAccountingOpeningBalances = parsed.fiscalYear === month.slice(0, 4) && parsed.openingBalance !== null
        ? { ...accountingOpeningBalancesRef.current, [balanceKey]: accountingOpeningBalancesRef.current[balanceKey] ?? parsed.openingBalance }
        : accountingOpeningBalancesRef.current
      persist(
        merged.movements, matchesRef.current, bankOpeningBalancesRef.current, nextAccountingOpeningBalances,
        bankClosingBalanceChecksRef.current, importBatchesRef.current,
      )
      setMessage(
        `SAF-T de ${parsed.companyName || parsed.companyTaxId}: ${merged.enriched} movimentos enriquecidos`
        + (merged.added ? ` e ${merged.added} movimentos contabilísticos acrescentados` : '')
        + '. As sugestões passam a usar documentos, contrapartidas e NIF.',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível interpretar o SAF-T.')
    } finally {
      setImportingSaft(false)
    }
  }

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter(current => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const confirmManual = () => {
    if (!selectedBank.size || !selectedAccounting.size) return setMessage('Seleciona movimentos nos dois lados.')
    if (Math.abs(difference) >= 0.01) return setMessage(`Os movimentos não fecham. Diferença: ${difference.toFixed(2)} €.`)
    const result = applyMatch(displayMovements, Array.from(selectedBank), Array.from(selectedAccounting), 'Reconciliação manual')
    const changed = new Map(result.movements.map(item => [item.id, item]))
    const next = movements.map(item => changed.get(item.id) ?? item)
    persist(next, [result.match, ...matches])
    const bankText = displayMovements.filter(item => selectedBank.has(item.id)).map(item => `${item.description} ${item.reference}`).join(' ')
    const accountingText = displayMovements.filter(item => selectedAccounting.has(item.id)).map(item => `${item.description} ${item.reference}`).join(' ')
    learnSmartRule(clientId, 'reconciliation', bankText, { accountingPattern: accountingText })
    setSelectedBank(new Set())
    setSelectedAccounting(new Set())
    setMessage('Movimentos reconciliados.')
  }

  const autoMatch = () => {
    const pairs = findExactMatches(displayMovements, tolerance)
    let nextMovements = movements
    const nextMatches = [...matches]
    for (const pair of pairs) {
      const result = applyMatch(nextMovements, [pair.bank.id], [pair.accounting.id], `Valor/natureza exatos, ±${tolerance} dias`)
      nextMovements = result.movements
      nextMatches.unshift(result.match)
    }
    persist(nextMovements, nextMatches)
    setMessage(`${pairs.length} pares reconciliados automaticamente.`)
  }

  const applyHighConfidenceMatches = () => {
    const approved = intelligentMatches.filter(item => item.confidence >= 90 && !item.ambiguous)
    const used = new Set<string>()
    let nextMovements = movements
    const nextMatches = [...matches]
    for (const suggestion of approved) {
      if (used.has(suggestion.accounting.id)) continue
      const result = applyMatch(nextMovements, [suggestion.bank.id], [suggestion.accounting.id], `Sugestão inteligente ${suggestion.confidence}%: ${suggestion.reasons.join(', ')}`)
      nextMovements = result.movements
      nextMatches.unshift(result.match)
      used.add(suggestion.accounting.id)
    }
    persist(nextMovements, nextMatches)
    setMessage(`${used.size} correspondências de confiança ≥90% aprovadas.`)
  }

  const applyGroupMatch = (index: number) => {
    const suggestion = groupMatches[index]
    if (!suggestion || suggestion.ambiguous) return setMessage('A sugestão é ambígua e exige seleção manual.')
    const result = applyMatch(movements, [suggestion.bank.id], suggestion.accounting.map(item => item.id), `Um-para-muitos ${suggestion.confidence}%: ${suggestion.reasons.join(', ')}`)
    persist(result.movements, [result.match, ...matches])
    setMessage(`Reconciliação 1:${suggestion.accounting.length} confirmada pelo utilizador.`)
  }

  const removeMatch = (match: ReconciliationMatch) => {
    persist(undoMatch(movements, match.id), matches.filter(item => item.id !== match.id))
    setMessage('Reconciliação desfeita.')
  }

  const clearAccount = () => {
    if (!account) return
    const ok = window.confirm(
      `Apagar todos os movimentos e reconciliações importados para a conta ${account}? Esta ação não pode ser desfeita.`
    )
    if (!ok) return
    const removedIds = new Set(movements.filter(item => item.account === account).map(item => item.id))
    const nextMovements = movements.filter(item => item.account !== account)
    const nextMatches = matches.filter(match =>
      ![...match.bankIds, ...match.accountingIds].some(id => removedIds.has(id))
    )
    const nextAccountingOpeningBalances = Object.fromEntries(
      Object.entries(accountingOpeningBalances).filter(([key]) => !key.startsWith(`${account}|`))
    )
    const nextBankOpeningBalances = Object.fromEntries(
      Object.entries(bankOpeningBalances).filter(([key]) => !key.startsWith(`${account}|`))
    )
    setSelectedBank(new Set())
    setSelectedAccounting(new Set())
    persist(nextMovements, nextMatches, nextBankOpeningBalances, nextAccountingOpeningBalances)
    setMessage(`Dados da conta ${account} apagados. Importa de novo o extrato e a razão.`)
  }

  return (
    <div className="banking-reconciliation">
      <div className="bank-toolbar">
        <label className="bank-account-field">Conta 12
          <select value={account} onChange={event => onAccountChange(event.target.value)}>
            <option value="">Selecionar conta</option>
            {accountOptions.map(item => <option key={item.code} value={item.code}>{item.code} — {item.description}</option>)}
          </select>
        </label>
        <label className="bank-month-field">Mês
          <input type="month" value={month} onChange={event => onMonthChange(event.target.value)} />
        </label>
        <label className="bank-tolerance-field">Tolerância de datas
          <input type="number" min="0" max="31" value={tolerance} onChange={event => setTolerance(Number(event.target.value))} />
        </label>
        <button className="bank-import-button" onClick={fetchLedger} disabled={!account || fetchingLedger}>
          {fetchingLedger ? 'A ler razão…' : 'Importar razão'}
        </button>
        <label className="bank-format-field">Formato do extrato
          <select value={bankFileFormat} onChange={event => setBankFileFormat(event.target.value as BankFileFormat)}>
            <option value="signed_amount">Valor único (+ entrada, − saída)</option>
            <option value="debit_credit">Colunas Débito e Crédito separadas</option>
          </select>
        </label>
        <label className="button-like bank-upload">Importar banco<input type="file" accept=".csv,.xlsx,.xls" onChange={event => {
          const file = event.target.files?.[0]; if (file) inspectBankFile(file); event.target.value = ''
        }} /></label>
        <label className={`button-like bank-saft-upload ${importingSaft ? 'is-disabled' : ''}`}>
          {importingSaft ? 'A ler SAF-T…' : 'Importar SAF-T'}
          <input type="file" accept=".xml,.zip" disabled={importingSaft} onChange={event => {
            const file = event.target.files?.[0]; if (file) importSaft(file); event.target.value = ''
          }} />
        </label>
        <button className="bank-clear-account" onClick={clearAccount} disabled={!account}>Limpar conta</button>
        <button className="bank-auto-match" onClick={autoMatch} disabled={!account}>Auto-reconciliar exatos</button>
      </div>

      {message && <div className="notice">{message}</div>}

      {account && (intelligentMatches.length > 0 || groupMatches.length > 0 || anomalies.length > 0) && (
        <section className="intelligence-panel" aria-label="Análise inteligente">
          <div>
            <span className="eyebrow">Análise inteligente</span>
            <strong>{intelligentMatches.length} correspondências simples · {groupMatches.length} agrupadas</strong>
            <small>{intelligentMatches.filter(item => item.confidence >= 90 && !item.ambiguous).length} seguras · {intelligentMatches.filter(item => item.ambiguous).length + groupMatches.filter(item => item.ambiguous).length} ambíguas nunca automáticas</small>
          </div>
          <div>
            <strong>{anomalies.length} anomalias</strong>
            <small>{anomalies.slice(0, 2).map(item => item.message).join(' · ') || 'Sem alertas'}</small>
          </div>
          <button onClick={applyHighConfidenceMatches} disabled={!intelligentMatches.some(item => item.confidence >= 90 && !item.ambiguous)}>
            Aprovar matches ≥90%
          </button>
        </section>
      )}
      {groupMatches.length > 0 && <section className="group-suggestions"><h3>Reconciliações um-para-muitos</h3>{groupMatches.slice(0, 5).map((suggestion, index) => <div key={suggestion.bank.id}><span><b>{suggestion.bank.amount.toFixed(2)} €</b> ↔ {suggestion.accounting.length} movimentos · confiança {suggestion.confidence}% {suggestion.ambiguous && '· ambígua'}</span><button className="ghost" disabled={suggestion.ambiguous} onClick={() => applyGroupMatch(index)}>Confirmar</button></div>)}</section>}

      {account && (
        <div className="balances-panel">
          <div className="balance-card bank">
            <span className="balance-label">Saldo inicial — Banco</span>
            <input
              type="number"
              step="0.01"
              value={bankOpeningBalance}
              onChange={event => setBankOpening(Number(event.target.value))}
            />
            <span className="balance-label">Saldo final — Banco</span>
            <strong>{formatEuro(bankClosingBalance)}</strong>
          </div>
          <div className="balance-card accounting">
            <span className="balance-label">Saldo inicial — Contabilidade</span>
            <strong>{accountingOpeningBalance === null ? '—' : formatEuro(accountingOpeningBalance)}</strong>
            <span className="balance-label">Saldo final — Contabilidade</span>
            <strong>{accountingClosingBalance === null ? '—' : formatEuro(accountingClosingBalance)}</strong>
          </div>
          <div className="balance-card check">
            <span className="balance-label">Saldo final do extrato (confirma)</span>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={bankClosingBalanceCheck ?? ''}
              onChange={event => setBankClosingCheck(Number(event.target.value))}
            />
          </div>
          <label className="sort-field bank-sort-field">Ordenar
            <select value={sortBy} onChange={event => setSortBy(event.target.value as SortBy)}>
              <option value="date">Data</option>
              <option value="amount">Valor</option>
            </select>
          </label>
          {accountingClosingBalance !== null && (
            <div className={`balance-check ${balancesMatch ? 'balanced' : 'unbalanced'}`}>
              {balancesMatch ? 'Banco e contabilidade fecham em ' + month : 'Diferença banco vs. contabilidade: ' + formatEuro(bankClosingBalance - accountingClosingBalance)}
            </div>
          )}
          {bankClosingBalanceCheck !== null && (
            <div className={`balance-check ${closingCheckMatches ? 'balanced' : 'unbalanced'}`}>
              {closingCheckMatches
                ? 'Importação completa: o saldo calculado bate com o extrato.'
                : `O saldo calculado (${formatEuro(bankClosingBalance)}) não bate com o extrato (${formatEuro(bankClosingBalanceCheck)}) — diferença ${formatEuro(bankClosingBalance - bankClosingBalanceCheck)}.`}
            </div>
          )}
        </div>
      )}

      {account && accountBatches.length > 0 && (
        <details className="import-history">
          <summary>Histórico de importações desta conta ({accountBatches.length})</summary>
          <table className="import-history-table">
            <thead>
              <tr><th>Ficheiro</th><th>Origem</th><th>Importado em</th><th>Movimentos</th><th></th></tr>
            </thead>
            <tbody>
              {accountBatches.map(batch => (
                <tr key={batch.id}>
                  <td>{batch.fileName}</td>
                  <td>{batch.source === 'bank' ? 'Banco' : 'Contabilidade'}</td>
                  <td>{new Date(batch.importedAt).toLocaleString('pt-PT')}</td>
                  <td>{batch.movementCount}</td>
                  <td><button type="button" className="link-button" onClick={() => cancelImportBatch(batch.id)}>Anular</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="reconciliation-grid">
        <MovementColumn
          title="Extrato bancário"
          source="bank"
          movements={displayMovements}
          selected={selectedBank}
          onToggle={id => toggle(setSelectedBank, id)}
          sortBy={sortBy}
          onShowMatch={matchId => setViewingMatch(matches.find(item => item.id === matchId) ?? null)}
        />
        <MovementColumn
          title="Conta 12 / Razão"
          source="accounting"
          movements={displayMovements}
          selected={selectedAccounting}
          onToggle={id => toggle(setSelectedAccounting, id)}
          sortBy={sortBy}
          onShowMatch={matchId => setViewingMatch(matches.find(item => item.id === matchId) ?? null)}
        />
      </div>

      <div className="match-bar">
        <span>Banco: <b>{selectedBank.size}</b></span>
        <span>Contabilidade: <b>{selectedAccounting.size}</b></span>
        <span>Diferença: <b className={Math.abs(difference) < 0.01 ? 'balanced' : 'unbalanced'}>{difference.toFixed(2)} €</b></span>
        <button onClick={confirmManual} disabled={!selectedBank.size || !selectedAccounting.size}>Confirmar reconciliação</button>
      </div>

      {viewingMatch && (
        <div className="modal-overlay" onClick={() => setViewingMatch(null)}>
          <div className="modal-card" onClick={event => event.stopPropagation()}>
            <header className="modal-header">
              <h3><span className="check-icon">✓</span> Detalhes do Match</h3>
              <button className="modal-close" onClick={() => setViewingMatch(null)}>×</button>
            </header>
            <div className="modal-body">
              {[...viewingMatch.bankIds, ...viewingMatch.accountingIds]
                .map(id => movements.find(item => item.id === id))
                .filter((item): item is BankMovement => Boolean(item))
                .map(item => (
                  <div className="modal-row" key={item.id}>
                    <input type="checkbox" checked readOnly />
                    <span className="modal-row-date">{item.date}<small>#{item.id.slice(-4)}</small></span>
                    <span className={`source-badge ${item.source}`}>{item.source === 'bank' ? 'Banco' : 'Contabilidade'}</span>
                    <span className="modal-row-desc">{item.description}</span>
                    <strong className={item.nature === 'D' ? 'debit' : 'credit'}>{item.amount.toFixed(2)} €</strong>
                  </div>
                ))}
            </div>
            <footer className="modal-footer">
              <button className="ghost" onClick={() => setViewingMatch(null)}>Fechar</button>
              <button className="danger" onClick={() => { removeMatch(viewingMatch); setViewingMatch(null) }}>Anular Match</button>
            </footer>
          </div>
        </div>
      )}
      {pendingImport && (
        <BankImportValidationModal
          fileName={pendingImport.fileName}
          totalRows={pendingImport.totalRows}
          movements={pendingImport.movements}
          duplicateIds={pendingImportDuplicateIds}
          openingBalance={bankOpeningBalance}
          closingBalanceCheck={bankClosingBalanceCheck}
          onConfirm={confirmPendingImport}
          onCancel={cancelPendingImport}
        />
      )}
      {detectedFile && (
        <FilePreviewDialog
          analysis={detectedFile.analysis}
          onCancel={() => setDetectedFile(null)}
          onConfirm={() => {
            const pending = detectedFile
            setBankFileFormat(pending.analysis.amountFormat)
            setDetectedFile(null)
            importFile(pending.file, 'bank', pending.analysis.amountFormat)
          }}
        />
      )}
    </div>
  )
}
