import React, { useMemo, useState } from 'react'
import { PrimaveraMasterData } from '../../core/master-data'
import { loadBankingState } from '../banking/bank-storage'
import { detectMovementAnomalies, findAdvancedMatches } from '../banking/reconciliation-intelligence'
import { loadPurchases, savePurchases } from '../purchases/purchase-storage'
import { PurchaseInvoice } from '../purchases/types'

type ExceptionKind = 'account' | 'nif' | 'vat' | 'duplicate' | 'unmatched' | 'total' | 'sync'
type WorkItem = { id: string; kind: ExceptionKind; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; invoiceId?: string; action: 'purchases' | 'banking' | 'settings' }
type Props = { clientId: string; masterData: PrimaveraMasterData; onNavigate: (tab: 'purchases' | 'banking' | 'settings') => void }

function duplicateInvoices(invoices: PurchaseInvoice[]) {
  const seen = new Set<string>(); const duplicates = new Set<string>()
  for (const invoice of invoices) {
    const key = `${invoice.documentDate}|${invoice.documentNo}|${invoice.supplierNif}|${invoice.totalAmount.toFixed(2)}`
    if (seen.has(key)) duplicates.add(invoice.id); else seen.add(key)
  }
  return duplicates
}

export function ExceptionCenter({ clientId, masterData, onNavigate }: Props) {
  const [revision, setRevision] = useState(0)
  const items = useMemo(() => {
    const invoices = loadPurchases(clientId).filter(invoice => invoice.status === 'pending')
    const bank = loadBankingState(clientId)
    const duplicates = duplicateInvoices(invoices)
    const work: WorkItem[] = []
    invoices.forEach(invoice => {
      if (!invoice.expenseAccount || !invoice.supplierAccount) work.push({ id: `account-${invoice.id}`, kind: 'account', severity: 'critical', title: 'Fatura sem conta', detail: `${invoice.documentNo} · ${invoice.supplierName}`, invoiceId: invoice.id, action: 'purchases' })
      if (!invoice.supplierNif || !masterData.suppliers.some(item => item.nif === invoice.supplierNif)) work.push({ id: `nif-${invoice.id}`, kind: 'nif', severity: 'warning', title: 'NIF desconhecido', detail: `${invoice.supplierName || 'Fornecedor sem nome'} · ${invoice.supplierNif || 'sem NIF'}`, invoiceId: invoice.id, action: 'purchases' })
      if (Math.abs(invoice.netAmount + invoice.vatAmount - invoice.totalAmount) >= 0.02 || (invoice.vatAmount > 0 && !invoice.vatCode)) work.push({ id: `vat-${invoice.id}`, kind: 'vat', severity: 'critical', title: 'IVA incoerente', detail: `${invoice.documentNo} · total ${invoice.totalAmount.toFixed(2)} €`, invoiceId: invoice.id, action: 'purchases' })
      if (duplicates.has(invoice.id)) work.push({ id: `duplicate-${invoice.id}`, kind: 'duplicate', severity: 'warning', title: 'Duplicado provável', detail: `${invoice.documentNo} · ${invoice.totalAmount.toFixed(2)} €`, invoiceId: invoice.id, action: 'purchases' })
    })
    const pendingBank = bank.movements.filter(item => item.status === 'pending')
    const matchedBankIds = new Set(findAdvancedMatches(pendingBank, 5).map(item => item.bank.id))
    pendingBank.filter(item => item.source === 'bank' && !matchedBankIds.has(item.id)).forEach(item => work.push({ id: `unmatched-${item.id}`, kind: 'unmatched', severity: 'info', title: 'Movimento sem correspondência', detail: `${item.date} · ${item.description} · ${item.amount.toFixed(2)} €`, action: 'banking' }))
    detectMovementAnomalies(pendingBank).forEach(item => work.push({ id: `anomaly-${item.movementId}`, kind: 'duplicate', severity: item.severity, title: 'Anomalia bancária', detail: item.message, action: 'banking' }))
    Object.entries(bank.bankClosingBalanceChecks ?? {}).forEach(([period, expected]) => {
      const [account, month] = period.split('|'); const opening = bank.bankOpeningBalances?.[period] ?? 0
      const calculated = opening + bank.movements.filter(item => item.account === account && item.source === 'bank' && item.date.startsWith(month)).reduce((sum, item) => sum + item.amount, 0)
      if (Math.abs(calculated - expected) >= 0.01) work.push({ id: `total-${period}`, kind: 'total', severity: 'critical', title: 'Diferença entre totais', detail: `${account} · ${month} · diferença ${(calculated - expected).toFixed(2)} €`, action: 'banking' })
    })
    if (!masterData.syncedAt || !masterData.accounts.length) work.unshift({ id: 'sync', kind: 'sync', severity: 'critical', title: 'Dados ainda não sincronizados', detail: 'Sincroniza o plano de contas, IVA e entidades do Primavera.', action: 'settings' })
    return work
  }, [clientId, masterData, revision])

  const quickFix = (item: WorkItem) => {
    if (!item.invoiceId) return onNavigate(item.action)
    const invoices = loadPurchases(clientId)
    const invoice = invoices.find(candidate => candidate.id === item.invoiceId)
    if (!invoice) return
    const known = masterData.suppliers.find(supplier => supplier.nif === invoice.supplierNif || supplier.name.toLowerCase() === invoice.supplierName.toLowerCase())
    if (!known?.account) return onNavigate('purchases')
    savePurchases(clientId, invoices.map(candidate => candidate.id === invoice.id ? { ...candidate, supplierNif: candidate.supplierNif || known.nif || '', supplierAccount: candidate.supplierAccount || known.account || '' } : candidate))
    setRevision(value => value + 1)
  }

  const counts = items.reduce<Record<string, number>>((result, item) => ({ ...result, [item.kind]: (result[item.kind] ?? 0) + 1 }), {})
  return (
    <section className="module-page exception-center">
      <header className="module-header"><div><span className="eyebrow">Centro de exceções</span><h2>Trabalho que precisa de atenção</h2><p className="muted">Todas as inconsistências de compras, bancos e sincronização numa só fila.</p></div><span className="exception-total">{items.length} pendentes</span></header>
      <div className="exception-filters">{Object.entries(counts).map(([kind, count]) => <span key={kind}>{kind}: <b>{count}</b></span>)}</div>
      <div className="exception-list">{items.map(item => <article key={item.id} className={`exception-item ${item.severity}`}><span className="exception-dot"/><div><strong>{item.title}</strong><p>{item.detail}</p></div><button className="ghost" onClick={() => quickFix(item)}>{item.invoiceId ? 'Tentar corrigir' : 'Resolver'}</button></article>)}{!items.length && <div className="empty-state">Sem exceções pendentes. O período está pronto para revisão final.</div>}</div>
    </section>
  )
}
