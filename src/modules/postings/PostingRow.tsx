import React from 'react'
import { PostingEntry } from './postings-txt'
import { PostingDraft } from './types'

type Props = {
  entry: PostingEntry
  selected: boolean
  onToggleSelect: (movementId: string) => void
  onChange: (draft: PostingDraft, remember: boolean) => void
}

export function PostingRow({ entry, selected, onToggleSelect, onChange }: Props) {
  const { movement, draft } = entry
  const update = (field: keyof PostingDraft, value: string) => {
    onChange({ ...draft, [field]: value }, true)
  }

  return (
    <tr className={draft.status === 'exported' ? 'is-exported' : ''}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          disabled={draft.status === 'exported'}
          onChange={() => onToggleSelect(movement.id)}
        />
      </td>
      <td>{movement.date}</td>
      <td><strong>{movement.description}</strong><small>{movement.reference}</small></td>
      <td className="number">
        <strong className={movement.amount >= 0 ? 'inflow' : 'outflow'}>{Math.abs(movement.amount).toFixed(2)} €</strong>
      </td>
      <td><input list="posting-accounts" value={draft.counterAccount} onChange={event => update('counterAccount', event.target.value)} placeholder="Conta contrapartida" />{draft.intelligence && <small className="smart-evidence">Conta {draft.counterAccount} · confiança {draft.intelligence.confidence}% · {draft.intelligence.evidence}</small>}</td>
      <td><input list="posting-journals" value={draft.journal} onChange={event => update('journal', event.target.value)} placeholder="Diário" /></td>
      <td><input list="posting-documents" value={draft.documentType} onChange={event => update('documentType', event.target.value)} placeholder="Documento" /></td>
      <td><span className={`posting-status ${draft.status}`}>{draft.status === 'exported' ? 'Lançado' : 'Pendente'}</span></td>
    </tr>
  )
}
