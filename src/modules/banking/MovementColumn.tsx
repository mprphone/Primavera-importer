import React, { useState } from 'react'
import { BankMovement, MovementSource } from './types'

export type SortBy = 'date' | 'amount'

type Props = {
  title: string
  source: MovementSource
  movements: BankMovement[]
  selected: Set<string>
  onToggle: (id: string) => void
  sortBy: SortBy
  onShowMatch: (matchId: string) => void
}

export function MovementColumn({ title, source, movements, selected, onToggle, sortBy, onShowMatch }: Props) {
  const [tab, setTab] = useState<'pending' | 'reconciled'>('pending')
  const sourceItems = movements.filter(item => item.source === source)
  const pending = sourceItems.filter(item => item.status === 'pending')
  const reconciled = sourceItems.filter(item => item.status === 'reconciled')
  const visible = tab === 'pending' ? pending : reconciled
  const sorted = [...visible].sort((a, b) => sortBy === 'amount'
    ? Math.abs(b.amount) - Math.abs(a.amount)
    : a.date.localeCompare(b.date))

  return (
    <section className={`movement-column ${source}`}>
      <header><h3>{title}</h3><span>{pending.length} pendentes</span></header>
      <div className="movement-tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          Pendentes ({pending.length})
        </button>
        <button className={tab === 'reconciled' ? 'active' : ''} onClick={() => setTab('reconciled')}>
          Reconciliados ({reconciled.length})
        </button>
      </div>
      <div className="movement-list">
        {sorted.map(item => {
          const isReconciled = item.status === 'reconciled'
          return (
            <div
              key={item.id}
              className={`movement-card ${selected.has(item.id) ? 'selected' : ''} ${isReconciled ? 'reconciled' : ''}`}
              onClick={() => (isReconciled && item.matchId ? onShowMatch(item.matchId) : onToggle(item.id))}
            >
              <input type="checkbox" checked={isReconciled || selected.has(item.id)} readOnly disabled={isReconciled} />
              <span className="movement-date">{item.date}</span>
              <span className="movement-description">
                {item.description}
                <small title={item.saft ? `SAF-T · Diário ${item.saft.journal} · Lançamento ${item.saft.postingNumber} · Contas ${item.saft.counterpartyAccounts.join(', ')}` : item.reference}>
                  {item.saft?.counterpartyName ? `${item.saft.counterpartyName}${item.reference ? ` · ${item.reference}` : ''}` : item.reference}
                </small>
              </span>
              <strong className={item.nature === 'D' ? 'debit' : 'credit'}>{Math.abs(item.amount).toFixed(2)} € <small>{item.nature}</small></strong>
            </div>
          )
        })}
        {!sorted.length && (
          <p className="empty-state">
            {tab === 'pending' ? 'Sem movimentos pendentes.' : 'Sem movimentos reconciliados.'}
          </p>
        )}
      </div>
    </section>
  )
}
