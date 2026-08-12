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

const movementEuro = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function movementDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

// O ERP devolve frequentemente o tipo do documento em "reference" (NP, NCN, TDEP...)
// quando a descrição já começa pelo mesmo código. Repeti-lo numa segunda linha só aumenta o
// ruído visual; preservamos a referência nos dados e no tooltip, mas só a mostramos se acrescentar
// informação ou se existir uma contrapartida vinda do SAF-T.
export function movementSecondaryLabel(item: BankMovement) {
  const reference = item.reference.trim()
  const description = normalizeLabel(item.description)
  const normalizedReference = normalizeLabel(reference)
  const redundantReference = !normalizedReference
    || description === normalizedReference
    || description.startsWith(`${normalizedReference} `)
  const usefulReference = redundantReference ? '' : reference
  const counterparty = item.saft?.counterpartyName?.trim() ?? ''

  return [counterparty, usefulReference]
    .filter((value, index, values) => value && values.findIndex(peer => normalizeLabel(peer) === normalizeLabel(value)) === index)
    .join(' · ')
}

export function MovementColumn({ title, source, movements, selected, onToggle, sortBy, onShowMatch }: Props) {
  const [tab, setTab] = useState<'pending' | 'reconciled'>('pending')
  const [query, setQuery] = useState('')
  const sourceItems = movements.filter(item => item.source === source)
  const pending = sourceItems.filter(item => item.status === 'pending')
  const reconciled = sourceItems.filter(item => item.status === 'reconciled')
  const visible = tab === 'pending' ? pending : reconciled
  const normalizedQuery = normalizeLabel(query)
  const filtered = normalizedQuery
    ? visible.filter(item => normalizeLabel(`${item.date} ${movementDate(item.date)} ${item.description} ${item.reference} ${item.saft?.counterpartyName ?? ''} ${Math.abs(item.amount).toFixed(2)} ${movementEuro.format(Math.abs(item.amount))}`).includes(normalizedQuery))
    : visible
  const sorted = [...filtered].sort((a, b) => sortBy === 'amount'
    ? Math.abs(b.amount) - Math.abs(a.amount)
    : a.date.localeCompare(b.date))

  return (
    <section className={`movement-column ${source}`}>
      <header>
        <div className="movement-column-title">
          <h3>{title}</h3>
          <span>{pending.length} pendentes</span>
        </div>
        <label className="movement-search">
          <span className="sr-only">Pesquisar em {title}</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Pesquisar data, documento ou valor…"
          />
        </label>
      </header>
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
          const secondaryLabel = movementSecondaryLabel(item)
          const technicalDetail = item.saft
            ? `SAF-T · Diário ${item.saft.journal} · Lançamento ${item.saft.postingNumber} · Contas ${item.saft.counterpartyAccounts.join(', ')}${item.reference ? ` · Referência ${item.reference}` : ''}`
            : item.reference
          return (
            <div
              key={item.id}
              className={`movement-card ${selected.has(item.id) ? 'selected' : ''} ${isReconciled ? 'reconciled' : ''}`}
              onClick={() => (isReconciled && item.matchId ? onShowMatch(item.matchId) : onToggle(item.id))}
              title={technicalDetail || undefined}
            >
              <input type="checkbox" checked={isReconciled || selected.has(item.id)} readOnly disabled={isReconciled} />
              <span className="movement-date">{movementDate(item.date)}</span>
              <span className="movement-description">
                <span>{item.description || 'Sem descrição'}</span>
                {secondaryLabel && <small>{secondaryLabel}</small>}
              </span>
              <strong className={item.nature === 'D' ? 'debit' : 'credit'}>{movementEuro.format(Math.abs(item.amount))} € <small>{item.nature}</small></strong>
            </div>
          )
        })}
        {!sorted.length && (
          <p className="empty-state">
            {query ? 'Nenhum movimento corresponde à pesquisa.' : tab === 'pending' ? 'Sem movimentos pendentes.' : 'Sem movimentos reconciliados.'}
          </p>
        )}
      </div>
    </section>
  )
}
