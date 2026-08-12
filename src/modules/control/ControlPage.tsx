import React, { useEffect, useMemo, useState } from 'react'
import { PrimaveraMasterData } from '../../core/master-data'
import { PurchaseIcon } from '../purchases/PurchaseIcon'
import { loadPurchases, refreshPurchasesFromServer, savePurchases } from '../purchases/purchase-storage'
import { applyManualValidation } from '../purchases/purchase-validation'
import { PurchaseInvoice } from '../purchases/types'
import '../purchases/purchases.css'
import { ControlBulkValidationModal } from './ControlBulkValidationModal'
import { ControlInvoiceRow } from './ControlInvoiceRow'
import './control.css'

type Props = {
  clientId: string
  masterData: PrimaveraMasterData
}

type ControlFilter = 'possible' | 'missing' | 'confirmed' | 'all'

export function ControlPage({ clientId, masterData }: Props) {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>(() => loadPurchases(clientId))
  const [filter, setFilter] = useState<ControlFilter>('possible')
  const [monthFilter, setMonthFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [showBulkValidation, setShowBulkValidation] = useState(false)
  const [bulkMessage, setBulkMessage] = useState('')

  useEffect(() => {
    setInvoices(loadPurchases(clientId))
  }, [clientId])

  useEffect(() => {
    let cancelled = false
    refreshPurchasesFromServer(clientId).then(remote => { if (!cancelled && remote) setInvoices(remote) })
    return () => { cancelled = true }
  }, [clientId])

  const persist = (next: PurchaseInvoice[]) => {
    setInvoices(next)
    savePurchases(clientId, next)
  }

  const accountNames = useMemo(
    () => new Map(masterData.accounts.map(account => [account.code, account.description])),
    [masterData.accounts],
  )
  const accountTitle = (account: string) => accountNames.get(account) || 'Conta contabilística'

  const checked = useMemo(() => invoices.filter(invoice => invoice.sqlVerification), [invoices])
  const counts = useMemo(() => ({
    possible: checked.filter(invoice => invoice.sqlVerification?.status === 'possible').length,
    missing: checked.filter(invoice => invoice.sqlVerification?.status === 'missing').length,
    confirmed: checked.filter(invoice => invoice.sqlVerification?.status === 'confirmed').length,
  }), [checked])

  const months = useMemo(() => {
    const unique = new Set(checked.map(invoice => invoice.documentDate.slice(0, 7)).filter(Boolean))
    return Array.from(unique).sort().reverse()
  }, [checked])

  const suppliers = useMemo(() => {
    const unique = new Map(checked.map(invoice => [invoice.supplierNif || invoice.supplierName, invoice.supplierName]))
    return Array.from(unique.entries()).filter(([key]) => key).sort((a, b) => a[1].localeCompare(b[1]))
  }, [checked])

  const scoped = useMemo(
    () => checked.filter(invoice =>
      (!monthFilter || invoice.documentDate.startsWith(monthFilter))
      && (!supplierFilter || (invoice.supplierNif || invoice.supplierName) === supplierFilter),
    ),
    [checked, monthFilter, supplierFilter],
  )
  const scopedCounts = useMemo(() => ({
    possible: scoped.filter(invoice => invoice.sqlVerification?.status === 'possible').length,
    missing: scoped.filter(invoice => invoice.sqlVerification?.status === 'missing').length,
    confirmed: scoped.filter(invoice => invoice.sqlVerification?.status === 'confirmed').length,
  }), [scoped])
  const visible = useMemo(
    () => scoped.filter(invoice => filter === 'all' || invoice.sqlVerification?.status === filter),
    [scoped, filter],
  )

  useEffect(() => {
    if (!scoped.length || filter === 'all' || scopedCounts[filter] > 0) return
    if (scopedCounts.missing > 0) setFilter('missing')
    else if (scopedCounts.possible > 0) setFilter('possible')
    else if (scopedCounts.confirmed > 0) setFilter('confirmed')
    else setFilter('all')
  }, [filter, scoped.length, scopedCounts.confirmed, scopedCounts.missing, scopedCounts.possible])
  const bulkCandidates = useMemo(
    () => visible.filter(invoice => invoice.sqlVerification?.status !== 'confirmed'),
    [visible],
  )
  const bulkCounts = useMemo(() => ({
    possible: bulkCandidates.filter(invoice => invoice.sqlVerification?.status === 'possible').length,
    missing: bulkCandidates.filter(invoice => invoice.sqlVerification?.status === 'missing').length,
  }), [bulkCandidates])
  const selectedSupplierName = suppliers.find(([key]) => key === supplierFilter)?.[1]
  const bulkScope = [
    monthFilter || 'todos os meses',
    selectedSupplierName || 'todos os fornecedores',
  ].join(' · ')

  const validate = (invoice: PurchaseInvoice, justification: string) => {
    persist(invoices.map(item => item.id === invoice.id ? applyManualValidation(item, justification) : item))
  }

  const validateBulk = (justification: string) => {
    const ids = new Set(bulkCandidates.map(invoice => invoice.id))
    persist(invoices.map(invoice => ids.has(invoice.id) ? applyManualValidation(invoice, justification) : invoice))
    setBulkMessage(`${ids.size} faturas validadas em lote com a justificação indicada.`)
    setShowBulkValidation(false)
  }

  return (
    <section className="module-page control-page">
      <header className="purchase-workspace-heading">
        <h2>Controlo <span>— Validação de faturas por confirmar</span></h2>
        <p>Revê as faturas que a verificação automática no Primavera não conseguiu confirmar com segurança. Clica numa linha para ver o lançamento encontrado e validar manualmente quando estiver correto.</p>
      </header>

      {!checked.length ? (
        <div className="purchase-panel control-empty-panel">
          <p className="muted">Ainda não há faturas verificadas. Vai a "Compras" e usa "Verificar no Primavera" primeiro.</p>
        </div>
      ) : (
        <>
          <div className="purchase-panel">
            <div className="control-overview">
              <div className="purchase-stats control-stats" aria-label="Resumo do controlo">
                <article>
                  <span className="purchase-stat-icon"><PurchaseIcon name="check" /></span>
                  <small>Confirmadas</small>
                  <strong>{counts.confirmed}</strong>
                  <em>Já reconciliadas</em>
                </article>
                <article>
                  <span className="purchase-stat-icon pending"><PurchaseIcon name="thinking" /></span>
                  <small>A rever</small>
                  <strong>{counts.possible}</strong>
                  <em>Precisam de confirmação</em>
                </article>
                <article>
                  <span className="purchase-stat-icon missing"><PurchaseIcon name="x" /></span>
                  <small>Não confirmadas</small>
                  <strong>{counts.missing}</strong>
                  <em>Sem lançamento encontrado</em>
                </article>
              </div>

              <div className="purchase-filter-fields">
                <label><span>Mês</span><select value={monthFilter} onChange={event => setMonthFilter(event.target.value)}>
                  <option value="">Todos os meses</option>
                  {months.map(month => <option key={month} value={month}>{month}</option>)}
                </select></label>
                <label className="supplier-filter-field"><span>Fornecedor</span><select className="supplier-filter" value={supplierFilter} onChange={event => setSupplierFilter(event.target.value)}>
                  <option value="">Todos os fornecedores</option>
                  {suppliers.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                </select></label>
              </div>
            </div>
          </div>

          <div className="purchase-list-panel">
            <div className="sql-verification-summary" aria-label="Filtrar por estado">
              <strong>Estado</strong>
              <button className={`confirmed ${filter === 'confirmed' ? 'active' : ''}`} onClick={() => setFilter('confirmed')}>Confirmadas · {scopedCounts.confirmed}</button>
              <button className={`possible ${filter === 'possible' ? 'active' : ''}`} onClick={() => setFilter('possible')}>A rever · {scopedCounts.possible}</button>
              <button className={`missing ${filter === 'missing' ? 'active' : ''}`} onClick={() => setFilter('missing')}>Não confirmadas · {scopedCounts.missing}</button>
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas · {scoped.length}</button>
              {bulkCandidates.length > 0 && (
                <button className="control-bulk-open" onClick={() => setShowBulkValidation(true)}>
                  <PurchaseIcon name="check" /> Justificar e validar todas · {bulkCandidates.length}
                </button>
              )}
            </div>

            {bulkMessage && <div className="notice control-bulk-message">{bulkMessage}</div>}

            {!visible.length && <p className="muted control-empty-list">Não há faturas neste filtro.</p>}

            {visible.length > 0 && (
              <div className="table-wrap control-table-wrap">
                <table className="control-table">
                  <thead>
                    <tr>
                      <th></th><th>Documento</th><th>Data</th><th>NIF</th><th>Fornecedor</th><th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(invoice => (
                      <ControlInvoiceRow key={invoice.id} invoice={invoice} accountTitle={accountTitle} onValidate={validate} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {showBulkValidation && (
            <ControlBulkValidationModal
              count={bulkCandidates.length}
              possibleCount={bulkCounts.possible}
              missingCount={bulkCounts.missing}
              scope={bulkScope}
              onValidate={validateBulk}
              onClose={() => setShowBulkValidation(false)}
            />
          )}
        </>
      )}
    </section>
  )
}
