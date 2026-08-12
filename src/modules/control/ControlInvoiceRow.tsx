import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { PurchaseIcon } from '../purchases/PurchaseIcon'
import { PurchaseInvoice } from '../purchases/types'
import { ControlValidationModal } from './ControlValidationModal'

type Props = {
  invoice: PurchaseInvoice
  accountTitle: (account: string) => string
  onValidate: (invoice: PurchaseInvoice, justification: string) => void
}

const euro = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ControlInvoiceRow({ invoice, accountTitle, onValidate }: Props) {
  const [open, setOpen] = useState(false)
  const verification = invoice.sqlVerification!
  const statusIcon = verification.status === 'confirmed' ? 'check' : verification.status === 'possible' ? 'thinking' : 'x'

  return (
    <>
      <tr className="control-row" onClick={() => setOpen(true)}>
        <td>
          <span
            className={`purchase-status ${verification.status}${verification.lowConfidence ? ' low-confidence' : ''}${verification.amountDifference ? ' amount-difference' : ''}${verification.directBank ? ' direct-bank' : ''}`}
            title={verification.evidence}
            aria-label={verification.evidence}
          >
            <PurchaseIcon name={statusIcon} />
            {verification.amountDifference ? `${euro.format(verification.amountDifference)} €` : verification.status === 'possible' && verification.directBank ? 'Banco' : null}
          </span>
        </td>
        <td><strong>{invoice.documentNo}</strong></td>
        <td>{invoice.documentDate}</td>
        <td>{invoice.supplierNif || '—'}</td>
        <td>{invoice.supplierName || 'Fornecedor por identificar'}</td>
        <td className="number">{euro.format(invoice.totalAmount)} €</td>
      </tr>
      {open && createPortal(
        <ControlValidationModal
          invoice={invoice}
          accountTitle={accountTitle}
          onValidate={justification => {
            onValidate(invoice, justification)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}
