import React, { FormEvent, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  count: number
  possibleCount: number
  missingCount: number
  scope: string
  onValidate: (justification: string) => void
  onClose: () => void
}

export function ControlBulkValidationModal({
  count, possibleCount, missingCount, scope, onValidate, onClose,
}: Props) {
  const [justification, setJustification] = useState('')
  const trimmedJustification = justification.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!trimmedJustification) return
    onValidate(trimmedJustification)
  }

  return createPortal(
    <div className="module-modal-backdrop" onClick={onClose}>
      <form className="module-modal control-bulk-validation-modal" onSubmit={submit} onClick={event => event.stopPropagation()}>
        <button type="button" className="module-modal-close" onClick={onClose}>×</button>
        <h2>Validar faturas em lote</h2>
        <p className="muted">
          Serão validadas <strong>{count} faturas</strong> abrangidas pelos filtros atuais.
        </p>

        <div className="control-bulk-summary">
          <span><strong>{possibleCount}</strong><small>A rever</small></span>
          <span className="missing"><strong>{missingCount}</strong><small>Não confirmadas</small></span>
          <span className="scope"><strong>Âmbito</strong><small>{scope}</small></span>
        </div>

        {missingCount > 0 && (
          <p className="control-bulk-warning">
            Inclui faturas sem lançamento encontrado automaticamente. Confirma que verificaste estes documentos no Primavera antes de continuar.
          </p>
        )}

        <label className="control-bulk-justification">
          <span>Justificação comum <strong aria-hidden="true">*</strong></span>
          <textarea
            autoFocus
            required
            value={justification}
            placeholder="Ex.: Confirmado no Primavera pelo extrato do fornecedor e pela data/valor dos documentos."
            onChange={event => setJustification(event.target.value)}
          />
          <small>A justificação ficará registada individualmente no histórico de cada fatura.</small>
        </label>

        <div className="purchase-detail-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="control-bulk-confirm" disabled={!trimmedJustification}>
            Validar {count} faturas
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
