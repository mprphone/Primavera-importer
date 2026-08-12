import React, { useMemo, useState } from 'react'
import { VatRegime } from '../../core/clients'
import { loadBankingState, saveBankingState } from '../banking/bank-storage'
import { applyMatch, findExactMatches } from '../banking/reconciliation-engine'
import { detectMovementAnomalies, findAdvancedMatches } from '../banking/reconciliation-intelligence'
import { fetchEfaturaMonth } from '../purchases/efatura-client'
import { parseEfaturaPortalRows } from '../purchases/efatura-parser'
import { loadPurchases, mergePurchases, savePurchases } from '../purchases/purchase-storage'
import { isInvoiceReadyForExport } from '../purchases/purchase-txt'

type Props = {
  clientId: string; vatRegime: VatRegime; gatewayUrl: string; companyCode: string
  onSync: () => Promise<void>; onNavigate: (tab: 'purchases' | 'banking' | 'settings') => void
}
type RunReport = { id: string; month: string; createdAt: string; collected: number; duplicates: number; reconciled: number; ready: number; exceptions: number; errors: string[]; undoneAt?: string }
type Snapshot = { runId: string; purchases: ReturnType<typeof loadPurchases>; banking: ReturnType<typeof loadBankingState> }

const historyKey = (clientId: string) => `primavera_automation_history_v1_${clientId}`
const snapshotKey = (clientId: string) => `primavera_automation_snapshot_v1_${clientId}`
const scheduleKey = (clientId: string) => `primavera_automation_schedule_v1_${clientId}`
const readHistory = (clientId: string): RunReport[] => { try { return JSON.parse(localStorage.getItem(historyKey(clientId)) ?? '[]') as RunReport[] } catch { return [] } }

function previousMonth() {
  const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}
function monthDates(month: string) {
  const [year, value] = month.split('-').map(Number); const last = new Date(year, value, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function MonthlyAutomationPage({ clientId, vatRegime, gatewayUrl, companyCode, onSync, onNavigate }: Props) {
  const [month, setMonth] = useState(previousMonth)
  const [approved, setApproved] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState(() => readHistory(clientId))
  const [recurring, setRecurring] = useState(() => localStorage.getItem(scheduleKey(clientId)) === 'enabled')
  const report = useMemo(() => {
    const purchases = loadPurchases(clientId).filter(item => item.documentDate.startsWith(month) && item.status === 'pending')
    const banking = loadBankingState(clientId).movements.filter(item => item.date.startsWith(month))
    const ready = purchases.filter(item => isInvoiceReadyForExport(item, vatRegime)).length
    return { purchases: purchases.length, ready, exceptions: purchases.length - ready, bankPending: banking.filter(item => item.source === 'bank' && item.status === 'pending').length, suggestions: findAdvancedMatches(banking, 5).length, anomalies: detectMovementAnomalies(banking).length }
  }, [clientId, month, history, vatRegime])

  const saveRun = (run: RunReport) => {
    const next = [run, ...history].slice(0, 12); setHistory(next); localStorage.setItem(historyKey(clientId), JSON.stringify(next))
  }

  const execute = async () => {
    if (!approved || running) return
    setRunning(true); setProgress(5)
    const runId = `run-${Date.now()}`
    const snapshot: Snapshot = { runId, purchases: loadPurchases(clientId), banking: loadBankingState(clientId) }
    localStorage.setItem(snapshotKey(clientId), JSON.stringify(snapshot))
    const errors: string[] = []; let collected = 0; let duplicates = 0; let reconciled = 0
    try { await onSync() } catch (error) { errors.push(error instanceof Error ? error.message : 'Falha ao sincronizar Primavera') }
    setProgress(30)
    try {
      const dates = monthDates(month); const fetched = await fetchEfaturaMonth(gatewayUrl, companyCode, dates.from, dates.to)
      const parsed = parseEfaturaPortalRows(fetched.rows); const merged = mergePurchases(loadPurchases(clientId), parsed.invoices)
      savePurchases(clientId, merged.invoices); collected = merged.added; duplicates = merged.duplicates
    } catch (error) { errors.push(error instanceof Error ? error.message : 'Falha na recolha e-Fatura') }
    setProgress(60)
    const banking = loadBankingState(clientId); let nextMovements = banking.movements; const nextMatches = [...banking.matches]
    const exact = findExactMatches(nextMovements.filter(item => item.date.startsWith(month)), 5)
    exact.forEach(pair => { const result = applyMatch(nextMovements, [pair.bank.id], [pair.accounting.id], 'Automação mensal: valor/data exatos'); nextMovements = result.movements; nextMatches.unshift(result.match); reconciled += 1 })
    saveBankingState(clientId, { ...banking, movements: nextMovements, matches: nextMatches })
    setProgress(85)
    const purchases = loadPurchases(clientId).filter(item => item.documentDate.startsWith(month) && item.status === 'pending')
    const ready = purchases.filter(item => isInvoiceReadyForExport(item, vatRegime)).length
    const run: RunReport = { id: runId, month, createdAt: new Date().toISOString(), collected, duplicates, reconciled, ready, exceptions: purchases.length - ready, errors }
    saveRun(run); setProgress(100); setApproved(false); setRunning(false)
  }

  const undo = () => {
    try {
      const snapshot = JSON.parse(localStorage.getItem(snapshotKey(clientId)) ?? 'null') as Snapshot | null
      if (!snapshot) return
      savePurchases(clientId, snapshot.purchases); saveBankingState(clientId, snapshot.banking)
      const next = history.map(run => run.id === snapshot.runId ? { ...run, undoneAt: new Date().toISOString() } : run)
      setHistory(next); localStorage.setItem(historyKey(clientId), JSON.stringify(next)); localStorage.removeItem(snapshotKey(clientId))
    } catch { /* snapshot inválido: não altera os dados atuais */ }
  }

  const toggleRecurring = () => {
    const next = !recurring; setRecurring(next)
    next ? localStorage.setItem(scheduleKey(clientId), 'enabled') : localStorage.removeItem(scheduleKey(clientId))
  }

  return (
    <section className="module-page automation-page">
      <header className="module-header"><div><span className="eyebrow">Automação mensal</span><h2>Fecho assistido e reversível</h2><p className="muted">Sincroniza, recolhe o e‑Fatura, reconcilia apenas pares exatos e prepara os lançamentos. Sugestões ambíguas ficam sempre para revisão.</p></div><label>Mês<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></header>
      <ol className="automation-steps">
        <li><span>1</span><div><strong>Sincronizar Primavera</strong><small>Plano, IVA, entidades e razão disponível</small></div><button className="ghost" onClick={() => onNavigate('settings')}>Configurar</button></li>
        <li><span>2</span><div><strong>Recolher e‑Fatura</strong><small>Mês anterior por defeito · duplicados preservados</small></div><button className="ghost" onClick={() => onNavigate('purchases')}>Ver compras</button></li>
        <li><span>3</span><div><strong>Reconciliar exatos</strong><small>{report.suggestions} sugestões; só valor/data inequívocos são aplicados</small></div><button className="ghost" onClick={() => onNavigate('banking')}>Ver bancos</button></li>
        <li><span>4</span><div><strong>Preparar lançamentos</strong><small>{report.ready} prontos · {report.exceptions} exceções</small></div></li>
      </ol>
      <div className="automation-summary"><div><b>{report.ready}</b><span>compras prontas</span></div><div><b>{report.exceptions}</b><span>exceções</span></div><div><b>{report.suggestions}</b><span>matches sugeridos</span></div><div><b>{report.anomalies}</b><span>anomalias</span></div></div>
      <div className="approval-panel"><label className="inline-check"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} /> Aprovo a execução e compreendo que nenhuma exportação TXT será feita automaticamente</label><button disabled={!approved || running} onClick={execute}>{running ? `A executar… ${progress}%` : 'Executar plano mensal'}</button></div>
      {running && <progress className="automation-progress" max="100" value={progress}>{progress}%</progress>}
      <div className="automation-recurring"><label className="inline-check"><input type="checkbox" checked={recurring} onChange={toggleRecurring} /> Preparar automaticamente o mês anterior quando abrir a aplicação</label><small>A execução continuará a exigir aprovação humana.</small></div>
      <section className="automation-history"><div className="section-heading"><h3>Histórico de execuções</h3><button className="ghost" onClick={undo} disabled={!localStorage.getItem(snapshotKey(clientId))}>Desfazer última execução</button></div>{history.map(run => <article key={run.id}><div><strong>{run.month}</strong><small>{new Date(run.createdAt).toLocaleString('pt-PT')}{run.undoneAt && ' · desfeita'}</small></div><span>{run.collected} recolhidas · {run.duplicates} duplicadas · {run.reconciled} reconciliadas · {run.exceptions} exceções</span>{run.errors.length > 0 && <span className="unbalanced">{run.errors.length} erros</span>}</article>)}{!history.length && <p className="empty-state">Ainda não existem execuções.</p>}</section>
    </section>
  )
}
