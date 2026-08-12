import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { VatRegime } from '../../core/clients'
import { PrimaveraMasterData } from '../../core/master-data'
import { PurchaseInvoiceDetailModal } from './PurchaseInvoiceDetailModal'
import { PurchaseIcon } from './PurchaseIcon'
import { findSubcodes } from './subaccount-warning'
import { PurchaseInvoice, PurchaseInvoiceLine } from './types'
import { isInvoiceReadyForExport } from './purchase-txt'
import { vatCodeOptionsForExpenseAccount } from './vat-class-pattern'

function SubcodeWarning({ subcodes }: { subcodes: string[] }) {
  if (!subcodes.length) return null
  return (
    <small className="subcode-warning" title={`Esta conta tem subcontas mais específicas — o ERP Evolution só aceita lançamentos na conta terminal: ${subcodes.join(', ')}`}>
      ⚠ tem subcontas
    </small>
  )
}

type Props = {
  invoice: PurchaseInvoice
  vatRegime: VatRegime
  masterData: PrimaveraMasterData
  reviewOrder?: number
  hasExportError?: boolean
  onChange: (next: PurchaseInvoice) => void
  onValidate: (invoice: PurchaseInvoice, justification: string) => void
  onRemove: (invoice: PurchaseInvoice) => void
}

export function PurchaseInvoiceRow({ invoice, vatRegime, masterData, reviewOrder, hasExportError, onChange, onValidate, onRemove }: Props) {
  const [showDetail, setShowDetail] = useState(false)
  const update = (field: keyof PurchaseInvoice, value: string | boolean) => {
    onChange({ ...invoice, [field]: value })
  }
  // Marcar como conferida é o último passo antes do TXT — não faz sentido dar o visto a uma
  // fatura que ainda nem tem contas preenchidas. Desmarcar continua sempre livre.
  const readyToReview = Boolean(invoice.reviewedAt) || isInvoiceReadyForExport(invoice, vatRegime)
  const toggleReviewed = () => {
    if (!readyToReview) return
    update('reviewedAt', invoice.reviewedAt ? '' : new Date().toISOString())
  }

  const saveDetailLines = (lines: PurchaseInvoiceLine[]) => {
    const netAmount = lines.reduce((sum, line) => sum + line.netAmount, 0)
    const vatAmount = lines.reduce((sum, line) => sum + line.vatAmount, 0)
    const primary = lines[0]
    onChange({
      ...invoice,
      detailLines: lines.length > 1 ? lines : undefined,
      expenseAccount: lines.length === 1 ? primary.expenseAccount : invoice.expenseAccount,
      vatCode: lines.length === 1 ? primary.vatCode : invoice.vatCode,
      netAmount,
      vatAmount,
    })
    setShowDetail(false)
  }

  const hasDetailLines = (invoice.detailLines?.length ?? 0) > 1
  const vatCodeOptions = vatCodeOptionsForExpenseAccount(masterData, invoice.expenseAccount)
  const vatDatalistId = `purchase-vat-codes-${invoice.id}`
  const expenseSubcodes = findSubcodes(invoice.expenseAccount, masterData.accounts.map(account => account.code))
  const vatCodeSubcodes = findSubcodes(invoice.vatCode, masterData.vatRates.map(rate => rate.code))
  const formatAmount = (value: number) => value.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const verificationStatus = invoice.sqlVerification?.status
  const statusIcon = verificationStatus === 'confirmed' ? 'check'
    : verificationStatus === 'possible' ? 'thinking'
      : verificationStatus === 'missing' ? 'x'
        : invoice.status === 'exported' ? 'exported' : 'pending'
  const statusLabel = verificationStatus === 'confirmed' ? 'Confirmada'
    : verificationStatus === 'possible' ? 'A rever'
      : verificationStatus === 'missing' ? 'Não confirmada'
        : invoice.status === 'exported' ? 'Lançada' : 'Pendente'
  // Texto curto para o badge — todos com o mesmo tamanho aproximado; o título (hover) mantém a
  // palavra completa para não perder clareza.
  const statusShortLabel = verificationStatus === 'confirmed' ? 'OK'
    : verificationStatus === 'possible' && invoice.sqlVerification?.amountDifference
      ? `Dif. ${formatAmount(invoice.sqlVerification.amountDifference)} €`
      : verificationStatus === 'possible' && invoice.sqlVerification?.directBank ? 'Banco'
      : verificationStatus === 'possible' ? 'Rever'
      : verificationStatus === 'missing' ? 'Não'
        : invoice.status === 'exported' ? 'Lançada' : 'Pendente'
  const statusTitle = invoice.sqlVerification?.evidence ? `${statusLabel} — ${invoice.sqlVerification.evidence}` : statusLabel

  return (
    <tr className={`${invoice.status === 'exported' ? 'is-exported' : ''}${hasExportError ? ' has-export-error' : ''}`}>
      <td><input type="checkbox" checked={invoice.selected} disabled={invoice.status === 'exported'} onChange={event => update('selected', event.target.checked)} /></td>
      <td>
        <span
          className={`purchase-status-badge ${verificationStatus ?? invoice.status}${invoice.sqlVerification?.lowConfidence ? ' low-confidence' : ''}${invoice.sqlVerification?.amountDifference ? ' amount-difference' : ''}${invoice.sqlVerification?.directBank ? ' direct-bank' : ''}`}
          title={statusTitle}
        >
          <PurchaseIcon name={statusIcon} />
          {statusShortLabel}
        </span>
      </td>
      <td>
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
          {invoice.reviewedAt ? `✔ (${reviewOrder ?? '…'})` : '—'}
        </button>
      </td>
      <td>{invoice.documentDate}</td>
      <td className="document-cell">
        <button type="button" className="document-link-button" onClick={() => setShowDetail(true)} title="Ver lançamento no Primavera e detalhes da fatura">
          {invoice.documentNo}
        </button>
      </td>
      <td>{invoice.supplierNif || 'Sem NIF'}</td>
      <td>{invoice.supplierName || '—'}</td>
      <td>{invoice.intelligence ? <span className={`confidence-badge ${invoice.intelligence.confidence >= 85 ? 'high' : 'medium'}`} title={`${invoice.expenseAccount || 'Conta sugerida'} — confiança ${invoice.intelligence.confidence}% — ${invoice.intelligence.evidence}`}>{invoice.intelligence.confidence}%<small>modelo confirmado</small></span> : <span className="confidence-badge manual">Manual</span>}</td>
      <td className="number">{formatAmount(invoice.netAmount)}</td>
      <td className="number">{formatAmount(invoice.vatAmount)}</td>
      <td className="number"><strong>{formatAmount(invoice.totalAmount)}</strong></td>
      <td className="col-expense-account">
        {hasDetailLines
          ? <span className="muted">{invoice.detailLines!.length} linhas</span>
          : (
            <>
              <input list="purchase-accounts" value={invoice.expenseAccount} onChange={event => update('expenseAccount', event.target.value)} placeholder="Conta gasto" />
              <SubcodeWarning subcodes={expenseSubcodes} />
            </>
          )}
      </td>
      {vatRegime !== 'isento' && (
        <td>
          {hasDetailLines ? <span className="muted">—</span> : (
            <>
              <input list={vatDatalistId} value={invoice.vatCode} onChange={event => update('vatCode', event.target.value)} placeholder="Código IVA" disabled={!invoice.vatAmount} />
              <datalist id={vatDatalistId}>
                {Array.from(new Map(vatCodeOptions.map(rate => [rate.code, rate])).values())
                  .map(rate => <option key={rate.code} value={rate.code}>{rate.description}</option>)}
              </datalist>
              <SubcodeWarning subcodes={vatCodeSubcodes} />
            </>
          )}
        </td>
      )}
      <td><input list="purchase-accounts" value={invoice.supplierAccount} onChange={event => update('supplierAccount', event.target.value)} placeholder="Conta fornecedor" /></td>
      <td className="col-journal"><input list="purchase-journals" value={invoice.journal} onChange={event => update('journal', event.target.value)} placeholder="Diário" /></td>
      <td className="col-document-type"><input list="purchase-documents" value={invoice.documentType} onChange={event => update('documentType', event.target.value)} placeholder="Documento" /></td>
      <td>
        <button type="button" className="icon-button trash-button" onClick={() => onRemove(invoice)} title="Remover esta fatura da lista (ex: documento anulado)" aria-label="Remover fatura">
          <PurchaseIcon name="trash" />
        </button>
      </td>
      {showDetail && createPortal(
        <PurchaseInvoiceDetailModal
          invoice={invoice}
          vatRegime={vatRegime}
          masterData={masterData}
          reviewOrder={reviewOrder}
          onSave={saveDetailLines}
          onChange={onChange}
          onValidate={justification => {
            onValidate(invoice, justification)
            setShowDetail(false)
          }}
          onClose={() => setShowDetail(false)}
        />,
        document.body,
      )}
    </tr>
  )
}
