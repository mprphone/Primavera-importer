import React, { useState } from 'react'
import { PurchaseInvoice } from '../purchases/types'

type Props = {
  invoice: PurchaseInvoice
  accountTitle: (account: string) => string
  onValidate: (justification: string) => void
  onClose: () => void
}

const euro = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusLabel = {
  confirmed: 'Confirmado',
  possible: 'A rever',
  missing: 'Não confirmado',
} as const

export function ControlValidationModal({ invoice, accountTitle, onValidate, onClose }: Props) {
  const [justification, setJustification] = useState('')
  const verification = invoice.sqlVerification!
  const posting = verification.posting

  return (
    <div className="module-modal-backdrop" onClick={onClose}>
      <div className="module-modal control-validation-modal" onClick={event => event.stopPropagation()}>
        <button className="module-modal-close" onClick={onClose}>×</button>
        <h2>Fatura {invoice.documentNo}</h2>
        <p className="muted">{invoice.supplierName || 'Fornecedor por identificar'} · NIF {invoice.supplierNif || '—'}</p>

        <div className="purchase-invoice-summary control-modal-summary">
          <div>
            <small>Total da fatura</small>
            <strong>{euro.format(invoice.totalAmount)} €</strong>
            <span>{invoice.documentDate}</span>
          </div>
          <div className={`control-status-box ${verification.status}${verification.lowConfidence ? ' low-confidence' : ''}${verification.amountDifference ? ' amount-difference' : ''}${verification.directBank ? ' direct-bank' : ''}`}>
            <small>Estado</small>
            <strong>{verification.amountDifference
              ? `Diferença de ${euro.format(verification.amountDifference)} €`
              : verification.directBank && verification.status === 'possible' ? 'A rever — direto no banco'
              : verification.lowConfidence ? 'A rever (só valor)' : statusLabel[verification.status]}</strong>
            <span>{verification.evidence}</span>
          </div>
        </div>

        {posting && (
          <div className="primavera-posting-table-wrap">
            <table className="primavera-posting-table">
              <thead>
                <tr><th>Conta</th><th>Descrição</th><th>Débito</th><th>Crédito</th></tr>
              </thead>
              <tbody>
                {posting.accounts.map((line, index) => (
                  <tr key={`${line.account}-${index}`}>
                    <td><strong>{line.account}</strong></td>
                    <td>{accountTitle(line.account)}</td>
                    <td className="number">{line.debit ? `${euro.format(line.debit)} €` : '—'}</td>
                    <td className="number">{line.credit ? `${euro.format(line.credit)} €` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="muted control-posting-meta">Diário {posting.journal} · Lançamento {posting.number} · {posting.date}</span>
          </div>
        )}

        {verification.status === 'confirmed' && verification.source === 'manual' && verification.manualReview && (
          <div className="manual-review-trail">
            <strong>✓ Validado manualmente</strong>
            <span>{verification.manualReview.justification || 'Sem justificação indicada.'}</span>
            <small>
              {new Date(verification.manualReview.validatedAt).toLocaleString('pt-PT')} · motivo automático anterior: {verification.manualReview.automaticEvidence}
            </small>
          </div>
        )}

        {verification.status !== 'confirmed' && (
          <div className="manual-validation-card">
            {!posting && (
              <p className="muted control-no-posting-note">
                A verificação automática não encontrou nenhum lançamento candidato. Se já confirmaste no Primavera
                que a fatura está lançada, podes validar à mesma.
              </p>
            )}
            <textarea
              className="manual-validation-input"
              placeholder="Justificação da validação…"
              value={justification}
              onChange={event => setJustification(event.target.value)}
            />
            <div className="purchase-detail-actions">
              <button type="button" className="manual-validate-action" onClick={() => onValidate(justification)}>
                ✓ Validar e passar a verde
              </button>
            </div>
          </div>
        )}

        <div className="purchase-detail-actions">
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
