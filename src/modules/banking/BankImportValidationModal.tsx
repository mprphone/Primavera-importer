import React, { useState } from 'react'
import { BankMovement } from './types'

type Props = {
  fileName: string
  totalRows: number
  movements: BankMovement[]
  duplicateIds: Set<string>
  openingBalance: number
  closingBalanceCheck: number | null
  onConfirm: (openingBalance: number, closingBalanceCheck: number) => void
  onCancel: () => void
}

function formatEuro(value: number) {
  return `${value.toFixed(2)} €`
}

export function BankImportValidationModal({
  fileName, totalRows, movements, duplicateIds, openingBalance: initialOpening, closingBalanceCheck: initialClosing, onConfirm, onCancel,
}: Props) {
  const [openingBalance, setOpeningBalance] = useState(initialOpening)
  const [closingBalanceCheck, setClosingBalanceCheck] = useState(initialClosing ?? 0)

  // Movimentos repetidos (mesma conta/data/valor/descrição de uma importação anterior) não voltam
  // a ser adicionados — por isso só contam para a soma/saldo os que são mesmo novos.
  const newMovements = movements.filter(item => !duplicateIds.has(item.id))
  const duplicateCount = movements.length - newMovements.length
  const sum = newMovements.reduce((total, item) => total + item.amount, 0)
  const calculatedClosing = openingBalance + sum
  const difference = calculatedClosing - closingBalanceCheck
  const balanced = Math.abs(difference) < 0.01
  const nothingToAccept = newMovements.length === 0

  return (
    <div className="module-modal-backdrop" onClick={onCancel}>
      <div className="module-modal bank-import-modal" onClick={event => event.stopPropagation()}>
        <button className="module-modal-close" onClick={onCancel}>×</button>
        <h2>Validar importação — {fileName}</h2>
        <p className="muted">Verifica os movimentos e o saldo antes de aceitar.</p>

        <div className="bank-import-stats">
          <div className="bank-import-stat">
            <span className="balance-label">Movimentos novos</span>
            <strong>{newMovements.length}{totalRows !== movements.length ? ` / ${totalRows} linhas` : ''}</strong>
          </div>
          <div className={`bank-import-stat ${duplicateCount ? 'unbalanced' : ''}`}>
            <span className="balance-label">Já importados antes</span>
            <strong>{duplicateCount}</strong>
          </div>
          <div className="bank-import-stat">
            <span className="balance-label">Soma dos novos</span>
            <strong>{formatEuro(sum)}</strong>
          </div>
          <div className={`bank-import-stat ${balanced ? 'balanced' : 'unbalanced'}`}>
            <span className="balance-label">Diferença</span>
            <strong>{formatEuro(difference)}</strong>
          </div>
        </div>

        {nothingToAccept && (
          <div className="bank-import-stat unbalanced bank-import-nothing">
            Todos os {movements.length} movimentos deste ficheiro já tinham sido importados antes — não há nada novo para aceitar.
          </div>
        )}

        <div className="balances-panel">
          <div className="balance-card bank">
            <span className="balance-label">Saldo inicial</span>
            <input type="number" step="0.01" value={openingBalance} onChange={event => setOpeningBalance(Number(event.target.value))} />
            <span className="balance-label">Saldo final calculado</span>
            <strong>{formatEuro(calculatedClosing)}</strong>
          </div>
          <div className="balance-card check">
            <span className="balance-label">Saldo final esperado (extrato)</span>
            <input type="number" step="0.01" value={closingBalanceCheck} onChange={event => setClosingBalanceCheck(Number(event.target.value))} />
          </div>
        </div>

        <div className="bank-import-preview">
          <h3>Pré-visualização ({movements.length} movimentos)</h3>
          <table className="import-history-table">
            <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead>
            <tbody>
              {movements.slice(0, 8).map(item => (
                <tr key={item.id} className={duplicateIds.has(item.id) ? 'is-duplicate' : ''}>
                  <td>{item.date}</td>
                  <td>{item.description || 'Sem descrição'}{duplicateIds.has(item.id) && <small> (já importado)</small>}</td>
                  <td className={`number ${item.amount >= 0 ? 'positive' : 'negative'}`}>{formatEuro(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {movements.length > 8 && <p className="muted">… e mais {movements.length - 8} movimentos.</p>}
        </div>

        <div className="purchase-detail-actions">
          <button type="button" className="secondary" onClick={onCancel}>Cancelar importação</button>
          <button type="button" onClick={() => onConfirm(openingBalance, closingBalanceCheck)} disabled={!balanced || nothingToAccept}>
            {nothingToAccept ? 'Nada para aceitar' : balanced ? 'Aceitar movimentos' : 'Corrige os saldos para continuar'}
          </button>
        </div>
      </div>
    </div>
  )
}
