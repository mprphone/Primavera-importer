import React, { useState } from 'react'
import { ClientProfile } from '../../core/clients'
import { PostingEntryPreview } from '../../core/generator'
import { PrimaveraMasterData } from '../../core/master-data'
import { PostingModel } from '../../core/models'
import { ParsedRow } from './types'
import { analyzeFile, FileAnalysis } from '../../core/file-intelligence'
import { FilePreviewDialog } from '../../ui/components/FilePreviewDialog'

type Props = {
  client: ClientProfile
  model: PostingModel
  year: number
  journal: string
  documentType: string
  startNumber: number
  debitAccount: string
  creditAccount: string
  rows: ParsedRow[]
  preview: PostingEntryPreview[]
  total: number
  message: string
  masterData: PrimaveraMasterData
  onModelChange: (value: string) => void
  onYearChange: (value: number) => void
  onJournalChange: (value: string) => void
  onDocumentChange: (value: string) => void
  onStartNumberChange: (value: number) => void
  onAccountChange: (field: 'creditAccount' | 'debitAccount', value: string) => void
  onExcel: (file: File) => void
  onExport: () => void
  onClear: () => void
  onOpenSettings: () => void
}

export function ImportWorkspace(props: Props) {
  const [detectedFile, setDetectedFile] = useState<{ file: File; analysis: FileAnalysis } | null>(null)
  const {
    client, model, year, journal, documentType, startNumber, debitAccount, creditAccount,
    rows, preview, total, message, masterData,
  } = props

  return (
    <>
      <div className="grid grid2 top-grid">
        <div className="card card-soft-green">
          <h3>1) Modelo e parâmetros</h3>
          <div className="row">
            <label>Modelo
              <select value={model.id} onChange={event => props.onModelChange(event.target.value)}>
                {client.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Ano
              <input list="primavera-years" type="number" value={year} onChange={event => props.onYearChange(Number(event.target.value))} />
            </label>
            <label>Diário
              <input list="primavera-journals" value={journal} onChange={event => props.onJournalChange(event.target.value)} placeholder="Ex.: 32" />
            </label>
            <label>Documento
              <input list="primavera-documents" value={documentType} onChange={event => props.onDocumentChange(event.target.value)} placeholder="Ex.: 321" />
            </label>
            <label>N.º Diário inicial
              <input type="number" value={startNumber} onChange={event => props.onStartNumberChange(Number(event.target.value))} />
            </label>
          </div>
          <p className="muted">{model.description}</p>
          <div className="account-grid">
            <label>Conta a débito
              <input list="primavera-accounts" value={debitAccount} onChange={event => props.onAccountChange('debitAccount', event.target.value)} placeholder="Configurar conta" />
            </label>
            <label>Conta a crédito
              <input list="primavera-accounts" value={creditAccount} onChange={event => props.onAccountChange('creditAccount', event.target.value)} placeholder="Configurar conta" />
            </label>
          </div>
        </div>

        <div className="card card-soft-orange">
          <h3>2) Importar Excel</h3>
          <p className="muted">Colunas esperadas: <b>Data</b>, <b>Descrição</b>, <b>Montante</b>.</p>
          <input type="file" accept=".xlsx,.xls" onChange={event => {
            const file = event.target.files?.[0]
            if (file) analyzeFile(file).then(analysis => setDetectedFile({ file, analysis }))
            event.target.value = ''
          }} />
          <div className="action-row">
            <button onClick={props.onExport} disabled={!rows.length}>Exportar TXT</button>
            <button className="secondary" onClick={props.onClear} disabled={!rows.length}>Limpar</button>
            <button className="secondary" onClick={props.onOpenSettings}>Configurações</button>
          </div>
          <div className="muted summary">Linhas: <b>{rows.length}</b> · Lançamentos: <b>{preview.length * 2}</b> · Total: <b>{total.toFixed(2)}</b></div>
          {message && <div className="notice">{message}</div>}
        </div>
      </div>

      <div className="card preview-card">
        <h3>3) Pré-visualização</h3>
        <p className="muted">Confere o Excel e os dois lançamentos contabilísticos gerados por movimento.</p>
        <div className="preview-panels">
          <div className="preview-panel">
            <h4>Excel importado</h4>
            <div className="table-wrap">
              <table className="excel-table">
                <thead><tr><th>#</th><th>Data</th><th>Descrição</th><th>Montante</th><th>Sugestão</th></tr></thead>
                <tbody>{rows.slice(0, 200).map((row, index) => (
                  <tr key={index}>
                    <td>{startNumber + index}</td><td>{row.date.toISOString().slice(0, 10)}</td><td>{row.description}</td>
                    <td className="number">{Math.abs(row.amount).toFixed(2)}</td>
                    <td>{row.suggested ? `${row.suggested.name} (${row.suggestedScore}%)` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div className="preview-panel">
            <h4>Lançamentos gerados</h4>
            <div className="table-wrap">
              <table className="posting-table">
                <thead><tr><th>#</th><th>Data</th><th>Num. Doc</th><th>Conta</th><th>D/C</th><th>Montante</th><th>Descrição</th><th>Linha TXT</th></tr></thead>
                <tbody>{preview.slice(0, 120).flatMap(entry => ([
                  <tr key={`${entry.numDoc}-credit`}>
                    <td>{entry.numDiario}</td><td>{entry.dateISO}</td><td>{entry.numDoc}</td><td>{entry.credit.account}</td><td>C</td>
                    <td className="number">{entry.credit.amount.toFixed(2)}</td><td>{entry.description}</td><td><code className="txt-line">{entry.credit.raw}</code></td>
                  </tr>,
                  <tr key={`${entry.numDoc}-debit`}>
                    <td>{entry.numDiario}</td><td>{entry.dateISO}</td><td>{entry.numDoc}</td><td>{entry.debit.account}</td><td>D</td>
                    <td className="number">{entry.debit.amount.toFixed(2)}</td><td>{entry.description}</td><td><code className="txt-line">{entry.debit.raw}</code></td>
                  </tr>,
                ]))}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <datalist id="primavera-years">{masterData.accountingYears.map(item => <option key={item.year} value={item.year}>{item.description}</option>)}</datalist>
      <datalist id="primavera-journals">{masterData.journals.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="primavera-documents">{masterData.documents.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      <datalist id="primavera-accounts">{masterData.accounts.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist>
      {detectedFile && <FilePreviewDialog analysis={detectedFile.analysis} canConfirm={Boolean(detectedFile.analysis.mapped.date && detectedFile.analysis.mapped.description && (detectedFile.analysis.mapped.amount || detectedFile.analysis.mapped.debit))} onCancel={() => setDetectedFile(null)} onConfirm={() => { const pending = detectedFile; setDetectedFile(null); props.onExcel(pending.file) }} />}
    </>
  )
}
