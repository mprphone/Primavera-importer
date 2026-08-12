import React, { useState } from 'react'
import { VatRegime } from '../../core/clients'
import { PrimaveraMasterData } from '../../core/master-data'
import { buildPurchasePostingPreview, isInvoiceReadyForExport, PurchasePostingPreviewLine } from './purchase-txt'
import { findSubcodes } from './subaccount-warning'
import { PurchaseInvoice, PurchaseInvoiceLine } from './types'
import { vatCodeOptionsForExpenseAccount } from './vat-class-pattern'

type Props = {
  invoice: PurchaseInvoice
  vatRegime: VatRegime
  masterData: PrimaveraMasterData
  reviewOrder?: number
  onSave: (lines: PurchaseInvoiceLine[]) => void
  onChange: (next: PurchaseInvoice) => void
  onValidate: (justification: string) => void
  onClose: () => void
}

let lineCounter = 0
const euro = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function newLine(): PurchaseInvoiceLine {
  lineCounter += 1
  return { id: `line-${Date.now()}-${lineCounter}`, netAmount: 0, vatAmount: 0, expenseAccount: '', vatCode: '' }
}

export function PurchaseInvoiceDetailModal({ invoice, vatRegime, masterData, reviewOrder, onSave, onChange, onValidate, onClose }: Props) {
  const [lines, setLines] = useState<PurchaseInvoiceLine[]>(() =>
    invoice.detailLines?.length
      ? invoice.detailLines
      : [{ id: newLine().id, netAmount: invoice.netAmount, vatAmount: invoice.vatAmount, expenseAccount: invoice.expenseAccount, vatCode: invoice.vatCode }]
  )
  const [justification, setJustification] = useState('')
  const readyToReview = Boolean(invoice.reviewedAt) || isInvoiceReadyForExport(invoice, vatRegime)
  const toggleReviewed = () => {
    if (!readyToReview) return
    onChange({ ...invoice, reviewedAt: invoice.reviewedAt ? '' : new Date().toISOString() })
  }

  const updateLine = (id: string, field: keyof PurchaseInvoiceLine, value: string) => {
    setLines(prev => prev.map(line => line.id === id
      ? { ...line, [field]: field === 'netAmount' || field === 'vatAmount' ? Number(value) || 0 : value }
      : line))
  }

  const updateGrossAmount = (id: string, value: string) => {
    setLines(prev => prev.map(line => line.id === id
      ? { ...line, netAmount: Number(value) || 0, vatAmount: 0 }
      : line))
  }

  const addLine = () => setLines(prev => [...prev, newLine()])
  const removeLine = (id: string) => setLines(prev => prev.filter(line => line.id !== id))

  const netSum = lines.reduce((sum, line) => sum + line.netAmount, 0)
  const vatSum = lines.reduce((sum, line) => sum + line.vatAmount, 0)
  const totalSum = netSum + vatSum
  const balanced = Math.abs(totalSum - invoice.totalAmount) < 0.02
  const verification = invoice.sqlVerification
  const canValidateManually = invoice.status === 'pending' && verification?.status !== 'confirmed'
  const posting = verification?.posting
  const normalizedNif = invoice.supplierNif.replace(/\D/g, '')
  const supplierForNif = normalizedNif
    ? masterData.suppliers.find(supplier => (supplier.nif ?? '').replace(/\D/g, '') === normalizedNif)
    : undefined
  const normalizedEntityCode = (value?: string) => {
    const clean = (value ?? '').trim().toUpperCase()
    return /^\d+$/.test(clean) ? clean.replace(/^0+(?=\d)/, '') : clean
  }
  const isSupplierEntityLine = (line: { entityCode?: string }) => Boolean(
    supplierForNif?.code
    && normalizedEntityCode(line.entityCode) === normalizedEntityCode(supplierForNif.code),
  )
  const postingDebit = posting?.accounts.reduce((sum, line) => sum + line.debit, 0) ?? 0
  const postingCredit = posting?.accounts.reduce((sum, line) => sum + line.credit, 0) ?? 0
  const postingSupplierLine = posting?.accounts.find(line => line.account === invoice.supplierAccount)
    ?? posting?.accounts.find(isSupplierEntityLine)
    ?? posting?.accounts.find(line => line.account.startsWith('22') && Math.abs(Math.max(line.debit, line.credit) - invoice.totalAmount) <= 0.020001)
  const postingAmountLine = posting?.accounts.find(line => Math.abs(Math.max(line.debit, line.credit) - invoice.totalAmount) <= 0.020001)
  const postingInvoiceAmount = postingSupplierLine
    ? Math.max(postingSupplierLine.debit, postingSupplierLine.credit)
    : postingAmountLine
      ? Math.max(postingAmountLine.debit, postingAmountLine.credit)
      : Math.min(postingDebit, postingCredit)
  const postingAmountDifference = Math.round(Math.abs(postingInvoiceAmount - invoice.totalAmount) * 100) / 100
  const postingAmountMatches = Boolean(posting && postingAmountDifference === 0)
  const postingAmountWithinTolerance = Boolean(posting && verification?.amountDifference && postingAmountDifference <= 0.02)
  const postingDateMatches = Boolean(posting && posting.date === invoice.documentDate)
  const postingDateDistance = posting
    ? Math.abs(Date.parse(`${posting.date}T00:00:00Z`) - Date.parse(`${invoice.documentDate}T00:00:00Z`)) / 86_400_000
    : Infinity
  const postingDateAccepted = postingDateMatches || Boolean(verification?.directBank && postingDateDistance <= 45)
  const postingSupplierMatches = Boolean(postingSupplierLine)
  const postingDocumentMatches = verification?.status === 'confirmed' && !verification.directBank
  const plannedPosting = buildPurchasePostingPreview(invoice, lines, vatRegime, masterData.vatRates)
  const plannedDebit = plannedPosting.reduce((sum, line) => sum + line.debit, 0)
  const plannedCredit = plannedPosting.reduce((sum, line) => sum + line.credit, 0)
  const accountNames = new Map(masterData.accounts.map(account => [account.code, account.description]))
  const accountTitle = (account: string) => account ? accountNames.get(account) || 'Conta contabilística' : 'Conta por definir'
  const previewLabel = (line: PurchasePostingPreviewLine) => {
    if (line.kind === 'expense') return vatRegime === 'isento' ? 'Gasto (IVA incluído)' : 'Gasto'
    if (line.kind === 'vat') return 'IVA dedutível'
    if (line.kind === 'payment') return 'Banco / Caixa'
    return line.debit ? 'Liquidação do fornecedor' : 'Fornecedor'
  }
  // Quando sabemos que o lançamento encontrado não é o desta fatura (ex: valor coincidente por
  // acaso), isto limpa a verificação e devolve a fatura a pendente — sem isto a próxima verificação
  // volta a encontrar o mesmo lançamento errado e a fatura nunca sai de "a rever"/"confirmado".
  const rejectMatch = () => {
    onChange({ ...invoice, sqlVerification: undefined, status: 'pending', selected: true, exportedAt: undefined, reopenedAt: new Date().toISOString() })
    onClose()
  }
  const manualValidationCard = canValidateManually ? (
    <section className="manual-validation-card purchase-inline-validation">
      <div className="manual-validation-heading">
        <h3>Confirmar manualmente</h3>
        <p className="muted">
          {verification?.posting
            ? 'Usa apenas se confirmaste que este lançamento pertence à fatura.'
            : verification
              ? 'Usa apenas se confirmaste a fatura diretamente no Primavera.'
              : 'Usa apenas depois de confirmares a fatura no Primavera.'}
        </p>
      </div>
      <div className="manual-validation-controls">
        <label>
          <span className="sr-only">Justificação obrigatória</span>
          <input
          type="text"
          className="manual-validation-input"
          placeholder="Justificação obrigatória — ex.: confirmado no diário 41, lançamento 123"
          value={justification}
          onChange={event => setJustification(event.target.value)}
          required
        />
        </label>
        <button
          type="button"
          className="manual-validate-action"
          disabled={!justification.trim()}
          onClick={() => onValidate(justification.trim())}
        >
          ✓ Confirmar como lançada
        </button>
      </div>
    </section>
  ) : null

  return (
    <div className="module-modal-backdrop" onClick={onClose}>
      <div className={`module-modal purchase-detail-modal ${posting ? 'has-posting' : ''}`} onClick={event => event.stopPropagation()}>
        <button className="module-modal-close" onClick={onClose} aria-label="Fechar">×</button>
        <div className="purchase-detail-title-row">
          <h2>Fatura {invoice.documentNo}</h2>
          <button
            type="button"
            className={`review-toggle-button${invoice.reviewedAt ? ' checked' : ''}`}
            onClick={toggleReviewed}
            disabled={!readyToReview}
            title={invoice.reviewedAt
              ? 'Conferida — clica para desmarcar'
              : readyToReview
                ? 'Marcar como conferida para o TXT'
                : 'Preenche primeiro a conta de gasto, código de IVA/conta de fornecedor e diário'}
          >
            {invoice.reviewedAt ? `✔ Conferida (${reviewOrder ?? '…'})` : 'Marcar como conferida'}
          </button>
        </div>
        <div className="purchase-invoice-summary">
          <div className="supplier-summary">
            <small>Fornecedor</small>
            <strong>{invoice.supplierName || 'Fornecedor por identificar'}</strong>
            <span>NIF {invoice.supplierNif || '—'} · Conta {invoice.supplierAccount || 'por definir'}</span>
          </div>
          <div>
            <small>Total da fatura</small>
            <strong>{euro.format(invoice.totalAmount)} €</strong>
            <span>{invoice.documentDate}</span>
          </div>
          <div className={vatRegime === 'isento' ? 'vat-nondeductible' : 'vat-deductible'}>
            <small>Tratamento do IVA</small>
            <strong>{vatRegime === 'isento' ? 'Sem dedução' : 'Regime normal'}</strong>
            <span>{vatRegime === 'isento' ? `${euro.format(invoice.vatAmount)} € incluídos no gasto` : `${euro.format(invoice.vatAmount)} € de IVA`}</span>
          </div>
          <div className="purchase-payment-toggle">
            <label>
              <input
                type="checkbox"
                checked={invoice.paid}
                disabled={invoice.status === 'exported'}
                onChange={event => onChange({ ...invoice, paid: event.target.checked, paymentAccount: event.target.checked ? invoice.paymentAccount : '' })}
              />
              Já paga
            </label>
            <input
              list="purchase-payment-accounts"
              value={invoice.paymentAccount}
              onChange={event => onChange({ ...invoice, paymentAccount: event.target.value })}
              placeholder="Banco/Caixa"
              disabled={!invoice.paid}
            />
          </div>
        </div>
        {posting ? (
          <section className="primavera-posting-card">
            <div className="primavera-posting-heading">
              <div className="primavera-posting-identity">
                <span className="eyebrow">Lançamento encontrado no Primavera</span>
                <div className="primavera-posting-title-line">
                  <strong>Diário {posting.journal} · Lançamento {posting.number}</strong>
                  <span className={`purchase-status ${verification?.status ?? 'possible'}${verification?.amountDifference ? ' amount-difference' : ''}${verification?.directBank ? ' direct-bank' : ''}`}>
                    {verification?.status === 'confirmed' ? 'Confirmado' : verification?.amountDifference ? `Diferença ${euro.format(verification.amountDifference)} €` : verification?.directBank ? 'Direto no banco' : 'A rever'}
                  </span>
                </div>
              </div>
              <button type="button" className="reject-match-button" onClick={rejectMatch} title="Usa quando confirmaste que este lançamento não é desta fatura">
                ✕ Não corresponde a esta fatura
              </button>
            </div>
            <div className="primavera-posting-meta" aria-label="Dados do lançamento">
              <span><small>Data</small><strong>{posting.date}</strong></span>
              <span><small>Origem</small><strong>
                {verification?.source === 'saft' ? 'SAF-T'
                  : verification?.source === 'manual' ? 'Manual'
                    : 'Ligação SQL'}
              </strong></span>
              <span><small>Documento</small><strong>{invoice.documentNo}</strong></span>
              <span><small>Valor da fatura</small><strong>{euro.format(invoice.totalAmount)} €</strong></span>
            </div>
            <div className="primavera-posting-table-wrap">
              <table className="primavera-posting-table">
                <thead>
                  <tr><th>Conta movimentada</th><th>Entidade</th><th>Débito</th><th>Crédito</th></tr>
                </thead>
                <tbody>
                  {posting.accounts.map((line, index) => (
                    <tr key={`${line.account}-${index}`}>
                      <td className="posting-account"><strong>{line.account}</strong><small>{accountTitle(line.account)}</small></td>
                      <td className="posting-entity">{line.account.startsWith('22') || line.account === invoice.supplierAccount || isSupplierEntityLine(line)
                        ? <><strong>{invoice.supplierName}</strong>{line.entityCode ? <small>Fornecedor {line.entityCode}</small> : null}</>
                        : '—'}</td>
                      <td className="number">{line.debit ? `${euro.format(line.debit)} €` : '—'}</td>
                      <td className="number">{line.credit ? `${euro.format(line.credit)} €` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Total</th>
                    <th className="number">{euro.format(postingDebit)} €</th>
                    <th className="number">{euro.format(postingCredit)} €</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ) : null}

        {posting ? (
          <>
            <section className="efatura-reconciliation-card">
              <div className="efatura-reconciliation-heading">
                <div>
                  <span className="eyebrow">Conferência com o e-Fatura</span>
                  <strong>Comparação entre a fatura e o lançamento contabilístico</strong>
                </div>
                <span className={`reconciliation-result ${verification?.status === 'confirmed' ? 'confirmed' : 'review'}`}>
                  {verification?.status === 'confirmed' ? 'Conferência concluída' : 'Requer confirmação'}
                </span>
              </div>
              <div className="efatura-check-grid">
                <article className={postingAmountMatches ? 'ok' : postingAmountWithinTolerance ? 'amount-difference' : 'review'}>
                  <div className="efatura-check-title"><small>Total</small><strong>{postingAmountMatches ? 'Confere' : postingAmountWithinTolerance ? `Diferença de ${euro.format(postingAmountDifference)} €` : 'A rever'}</strong></div>
                  <span>e-Fatura: {euro.format(invoice.totalAmount)} € · Primavera: {euro.format(postingInvoiceAmount)} €</span>
                </article>
                <article className={postingDateAccepted ? 'ok' : 'review'}>
                  <div className="efatura-check-title"><small>Data</small><strong>{postingDateMatches ? 'Confere' : postingDateAccepted ? 'Mesmo período' : 'A rever'}</strong></div>
                  <span>e-Fatura: {invoice.documentDate} · Primavera: {posting.date}</span>
                </article>
                <article className={postingSupplierMatches ? 'ok' : 'review'}>
                  <div className="efatura-check-title"><small>Fornecedor / conta</small><strong>{postingSupplierMatches ? 'Confere' : 'A rever'}</strong></div>
                  <span>{invoice.supplierName || 'Fornecedor por identificar'} · {postingSupplierLine?.account || 'conta não confirmada'}</span>
                </article>
                <article className={postingDocumentMatches || verification?.directBank ? 'ok' : 'review'}>
                  <div className="efatura-check-title"><small>Número do documento</small><strong>{verification?.directBank ? 'Não exigido' : postingDocumentMatches ? 'Confirmado' : 'A rever'}</strong></div>
                  <span>{verification?.evidence || 'Sem evidência adicional.'}</span>
                </article>
              </div>
            </section>
            {manualValidationCard}
          </>
        ) : (
          <>
            <section className="purchase-posting-preview">
          <div className="purchase-posting-preview-heading">
            <div>
              <span className="eyebrow">Movimento previsto para exportação</span>
              <strong>{invoice.journal ? `Diário ${invoice.journal}` : 'Diário por definir'} · {invoice.documentType ? `Documento ${invoice.documentType}` : 'tipo por definir'}</strong>
            </div>
            <span className={`posting-balance-pill ${Math.abs(plannedDebit - plannedCredit) < 0.01 ? 'balanced' : 'unbalanced'}`}>
              {Math.abs(plannedDebit - plannedCredit) < 0.01 ? 'Balanceado' : 'Não balanceado'}
            </span>
          </div>
          {vatRegime === 'isento' && (
            <p className="vat-treatment-note">Nesta empresa, o IVA suportado não é apresentado numa conta de IVA dedutível: fica incluído no valor debitado à conta de gasto.</p>
          )}
          <div className="primavera-posting-table-wrap">
            <table className="primavera-posting-table planned-posting-table">
              <thead>
                <tr><th>Conta / movimento</th><th>Entidade</th><th>Débito</th><th>Crédito</th></tr>
              </thead>
              <tbody>
                {plannedPosting.map(line => (
                  <tr key={line.id} className={!line.account ? 'missing-account' : ''}>
                    <td className="posting-account">
                      <strong>{line.account || 'Por definir'}</strong>
                      <small>{previewLabel(line)} · {accountTitle(line.account)}</small>
                    </td>
                    <td>{line.kind === 'supplier' ? <><strong>{invoice.supplierName}</strong><small>NIF {invoice.supplierNif || '—'}</small></> : '—'}</td>
                    <td className="number">{line.debit ? `${euro.format(line.debit)} €` : '—'}</td>
                    <td className="number">{line.credit ? `${euro.format(line.credit)} €` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Total do movimento</th>
                  <th className="number">{euro.format(plannedDebit)} €</th>
                  <th className="number">{euro.format(plannedCredit)} €</th>
                </tr>
              </tfoot>
            </table>
          </div>
            </section>

            {verification ? (
              <div className={`primavera-posting-unavailable compact ${verification.status}`}>
                <strong>{verification.status === 'missing' ? 'Ainda não foi encontrado um lançamento correspondente' : 'Existe uma possibilidade no Primavera, ainda sem detalhe seguro'}</strong>
                <span>{verification.evidence}</span>
              </div>
            ) : (
              <div className="primavera-posting-unavailable compact">
                <strong>Ainda não verificada no Primavera</strong>
                <span>Use “Verificar no Primavera” para comparar este movimento previsto com a contabilidade.</span>
              </div>
            )}

            {manualValidationCard}

            <div className="purchase-detail-heading">
          <h3>{vatRegime === 'isento' ? 'Distribuição do gasto' : 'Distribuição da fatura'}</h3>
          <p className="muted">{vatRegime === 'isento'
            ? 'O total, já com IVA incluído, pode ser dividido por uma ou mais contas de gasto.'
            : 'Divide a fatura por conta de gasto/código de IVA quando tiver mais do que uma taxa.'}</p>
            </div>
            <table className={`purchase-detail-table ${vatRegime === 'isento' ? 'isento' : ''}`}>
          <thead>
            {vatRegime === 'isento'
              ? <tr><th>Valor no gasto</th><th>Conta de gasto</th><th></th></tr>
              : <tr><th>Base</th><th>IVA</th><th>Conta gasto</th><th>Código IVA</th><th></th></tr>}
          </thead>
          <tbody>
            {lines.map(line => {
              const expenseSubcodes = findSubcodes(line.expenseAccount, masterData.accounts.map(account => account.code))
              if (vatRegime === 'isento') {
                return (
                  <tr key={line.id}>
                    <td><input type="number" step="0.01" value={Number((line.netAmount + line.vatAmount).toFixed(2))} onChange={event => updateGrossAmount(line.id, event.target.value)} /></td>
                    <td>
                      <input list="purchase-accounts" value={line.expenseAccount} onChange={event => updateLine(line.id, 'expenseAccount', event.target.value)} placeholder="Conta de gasto" />
                      {expenseSubcodes.length > 0 && <small className="subcode-warning">⚠ tem subcontas</small>}
                    </td>
                    <td><button type="button" className="link-button" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>Remover</button></td>
                  </tr>
                )
              }
              const vatOptions = vatCodeOptionsForExpenseAccount(masterData, line.expenseAccount)
              const datalistId = `detail-vat-codes-${line.id}`
              const vatCodeSubcodes = findSubcodes(line.vatCode, masterData.vatRates.map(rate => rate.code))
              return (
                <tr key={line.id}>
                  <td><input type="number" step="0.01" value={line.netAmount} onChange={event => updateLine(line.id, 'netAmount', event.target.value)} /></td>
                  <td><input type="number" step="0.01" value={line.vatAmount} onChange={event => updateLine(line.id, 'vatAmount', event.target.value)} /></td>
                  <td>
                    <input list="purchase-accounts" value={line.expenseAccount} onChange={event => updateLine(line.id, 'expenseAccount', event.target.value)} placeholder="Conta gasto" />
                    {expenseSubcodes.length > 0 && (
                      <small className="subcode-warning" title={`Esta conta tem subcontas mais específicas: ${expenseSubcodes.join(', ')}`}>⚠ tem subcontas</small>
                    )}
                  </td>
                  <td>
                    <input list={datalistId} value={line.vatCode} onChange={event => updateLine(line.id, 'vatCode', event.target.value)} placeholder="Código IVA" />
                    <datalist id={datalistId}>
                      {Array.from(new Map(vatOptions.map(rate => [rate.code, rate])).values())
                        .map(rate => <option key={rate.code} value={rate.code}>{rate.description}</option>)}
                    </datalist>
                    {vatCodeSubcodes.length > 0 && (
                      <small className="subcode-warning" title={`Este código tem subcódigos mais específicos: ${vatCodeSubcodes.join(', ')}`}>⚠ tem subcontas</small>
                    )}
                  </td>
                  <td><button type="button" className="link-button" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>Remover</button></td>
                </tr>
              )
            })}
          </tbody>
            </table>
            <button type="button" className="secondary" onClick={addLine}>+ {vatRegime === 'isento' ? 'Adicionar conta de gasto' : 'Adicionar linha'}</button>
            <div className={`purchase-detail-totals ${balanced ? '' : 'unbalanced'}`}>
          {vatRegime === 'isento'
            ? `Gasto distribuído: ${euro.format(totalSum)} € · Total da fatura: ${euro.format(invoice.totalAmount)} €`
            : `Base ${euro.format(netSum)} + IVA ${euro.format(vatSum)} = ${euro.format(totalSum)} € (fatura: ${euro.format(invoice.totalAmount)} €)`}
          {!balanced && <strong> — não fecha com o total da fatura</strong>}
            </div>
            <div className="purchase-detail-actions">
              <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
              <button type="button" onClick={() => onSave(lines)} disabled={!balanced}>Guardar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
