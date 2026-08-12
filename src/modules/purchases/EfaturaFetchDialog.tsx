import React, { useMemo, useState } from 'react'

const months = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

type Props = {
  defaultYear: number
  loading: boolean
  onClose: () => void
  onFetch: (dateFrom: string, dateTo: string) => void
}

export function EfaturaFetchDialog({ defaultYear, loading, onClose, onFetch }: Props) {
  const [year, setYear] = useState(defaultYear)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const range = useMemo(() => {
    const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const dateTo = `${year}-${String(month).padStart(2, '0')}-${lastDay}`
    return { dateFrom, dateTo }
  }, [year, month])

  return (
    <div className="module-modal-backdrop" onClick={loading ? undefined : onClose}>
      <div className="module-modal" onClick={event => event.stopPropagation()}>
        <button className="module-modal-close" onClick={onClose} disabled={loading}>×</button>
        <span className="eyebrow">Portal das Finanças</span>
        <h2>Importar faturas do e‑Fatura</h2>
        <p className="muted">O gateway inicia sessão com os acessos cifrados e recolhe as despesas da atividade.</p>
        <div className="efatura-period-grid">
          <label>Ano<input type="number" value={year} onChange={event => setYear(Number(event.target.value))} /></label>
          <label>Mês
            <select value={month} onChange={event => setMonth(Number(event.target.value))}>
              {months.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
            </select>
          </label>
          <label>De<input value={range.dateFrom} readOnly /></label>
          <label>Até<input value={range.dateTo} readOnly /></label>
        </div>
        <div className="security-note">Se a AT pedir autenticação adicional/2FA, a recolha é interrompida em segurança.</div>
        <div className="action-row">
          <button onClick={() => onFetch(range.dateFrom, range.dateTo)} disabled={loading}>
            {loading ? 'A importar do e‑Fatura…' : 'Importar do e‑Fatura'}
          </button>
          <button className="ghost" onClick={onClose} disabled={loading}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
