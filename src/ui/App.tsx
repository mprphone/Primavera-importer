import React, { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { BuiltInModels } from '../core/models'
import { buildPostingPreview, generateTxt, InputRow } from '../core/generator'
import { Entity, loadLocalEntities, saveLocalEntities, suggestEntity } from '../core/entities'

type ParsedRow = InputRow & { suggested?: Entity; suggestedScore?: number }

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=windows-1252' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function parseExcel(file: File): ParsedRow[] {
  const data = new Uint8Array()
  // Placeholder: will be read via FileReader in handler
  return []
}

function tryParseDate(v: any): Date | null {
  if (v instanceof Date) return v
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return new Date(d.y, d.m - 1, d.d)
  }
  if (typeof v === 'string') {
    // dd-mm-yyyy or yyyy-mm-dd
    const s = v.trim()
    const m1 = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/)
    if (m1) return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]))
    const m2 = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/)
    if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]))
  }
  return null
}

function App() {
  const [modelId, setModelId] = useState(BuiltInModels[0].id)
  const model = useMemo(() => BuiltInModels.find(m => m.id === modelId)!, [modelId])

  const [ano, setAno] = useState(2025)
  const [diario, setDiario] = useState('32')
  const [documento, setDocumento] = useState('321')
  const [startNumDiario, setStartNumDiario] = useState(120001)

  const [rows, setRows] = useState<ParsedRow[]>([])
  const [entities, setEntities] = useState<Entity[]>(() => loadLocalEntities())
  const [entityPaste, setEntityPaste] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const totals = useMemo(() => {
    const sum = rows.reduce((a, r) => a + Math.abs(r.amount || 0), 0)
    return sum
  }, [rows])
  const postingPreview = useMemo(
    () => buildPostingPreview(model, rows, { ano, diario, documento, startNumDiario }),
    [model, rows, ano, diario, documento, startNumDiario],
  )

  const onExcel = async (file: File) => {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

    // Expect columns: Data, Descrição, Montante (case-insensitive)
    const out: ParsedRow[] = []
    for (const r of json) {
      const keys = Object.keys(r)
      const get = (name: string) => {
        const k = keys.find(k => k.trim().toLowerCase() === name.toLowerCase())
        return k ? r[k] : ''
      }

      const d = tryParseDate(get('Data') || get('Data da operação') || get('Data da operacao'))
      const desc = String(get('Descrição') || get('Descricao') || get('Descrição da Conta') || get('Descricao da Conta') || '').trim()
      const amtRaw = get('Montante') || get('Valor') || get('Importe') || get('Total')
      const amt = typeof amtRaw === 'number' ? amtRaw : Number(String(amtRaw).replace(/\./g,'').replace(',', '.'))
      if (!d || !desc || !isFinite(amt)) continue

      const sug = suggestEntity(desc, entities)
      out.push({ date: d, description: desc, amount: amt, suggested: sug.entity, suggestedScore: sug.score })
    }
    setRows(out)
  }

  const parseEntitiesFromPaste = () => {
    // Expect TSV/CSV with columns: Tipo, Codigo, Nome, NIF, PalavrasChave
    const lines = entityPaste.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const parsed: Entity[] = []
    for (const line of lines) {
      const parts = line.split(/\t|;/).map(p => p.trim())
      if (parts.length < 3) continue
      const type = (parts[0].toLowerCase().includes('c') ? 'customer' : 'supplier') as any
      parsed.push({
        type,
        code: parts[1],
        name: parts[2],
        nif: parts[3] || undefined,
        keywords: parts[4] || undefined,
      })
    }
    const merged = [...entities, ...parsed]
    setEntities(merged)
    saveLocalEntities(merged)
    setEntityPaste('')
  }

  const exportTxt = () => {
    const txt = generateTxt(model, rows, { ano, diario, documento, startNumDiario })
    downloadText(`primavera_${model.id}_${ano}_${diario}_${documento}.txt`, txt)
  }

  return (
    <div className="container">
      <h1 style={{marginTop:0}}>Primavera TXT Importer (v10) — Smart</h1>
      <p className="muted">Importa Excel, aplica um modelo, sugere entidades (modo local) e exporta TXT fixed-width compatível com o importador.</p>

      <div className="grid grid2 top-grid">
        <div className="card card-soft-green">
          <h3 style={{marginTop:0}}>1) Modelo e parâmetros</h3>
          <div className="row">
            <label>
              Modelo
              <select value={modelId} onChange={e => setModelId(e.target.value)}>
                {BuiltInModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label>
              Ano
              <input type="number" value={ano} onChange={e => setAno(Number(e.target.value))} />
            </label>
            <label>
              Diário
              <input value={diario} onChange={e => setDiario(e.target.value)} />
            </label>
            <label>
              Documento
              <input value={documento} onChange={e => setDocumento(e.target.value)} />
            </label>
            <label>
              N.º Diário inicial
              <input type="number" value={startNumDiario} onChange={e => setStartNumDiario(Number(e.target.value))} />
            </label>
          </div>
          <p className="muted" style={{marginBottom:0}}>{model.description}</p>
          <div style={{marginTop:12}}>
            <span className="badge">Crédito: {model.creditAccountFixed}</span>{' '}
            <span className="badge">Débito: {model.debitAccountFixed}</span>
          </div>
        </div>

        <div className="card card-soft-orange">
          <h3 style={{marginTop:0}}>2) Importar Excel</h3>
          <p className="muted">Colunas esperadas: <b>Data</b>, <b>Descrição</b>, <b>Montante</b> (ou “Data da operação”, “Descrição da Conta”).</p>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) onExcel(f)
            }}
          />
          <div style={{marginTop:12}} className="row">
            <button onClick={exportTxt} disabled={rows.length === 0}>Exportar TXT</button>
            <button className="secondary" onClick={() => setRows([])} disabled={rows.length === 0}>Limpar</button>
            <button className="secondary" onClick={() => setShowSettings(v => !v)}>
              {showSettings ? 'Fechar Configurações' : 'Configurações'}
            </button>
            <div className="muted">Linhas: <b>{rows.length}</b> · Lançamentos: <b>{postingPreview.length * 2}</b> · Total montantes: <b>{totals.toFixed(2)}</b></div>
          </div>
        </div>
      </div>

      <div className="grid workspace-grid" style={{marginTop:16}}>
        {showSettings && (
          <div className="card card-soft-yellow">
            <h3 style={{marginTop:0}}>Configurações</h3>
            <h4 style={{marginTop:0, marginBottom: 8}}>Entidades (modo local)</h4>
            <p className="muted">Cola linhas TSV/; no formato: <b>Tipo</b> (F/C), <b>Código</b>, <b>Nome</b>, <b>NIF</b>, <b>PalavrasChave</b> (separadas por |).</p>
            <textarea value={entityPaste} onChange={e => setEntityPaste(e.target.value)} placeholder="F	500844321	Banco Santander Totta SA		SANTANDER|TOTTA" />
            <div className="row" style={{marginTop:12}}>
              <button onClick={parseEntitiesFromPaste} disabled={!entityPaste.trim()}>Adicionar à lista</button>
              <button className="secondary" onClick={() => { setEntities([]); saveLocalEntities([]) }} disabled={entities.length===0}>Limpar entidades</button>
              <div className="muted">Entidades guardadas: <b>{entities.length}</b></div>
            </div>
          </div>
        )}

        <div className="card preview-card">
          <h3 style={{marginTop:0}}>3) Pré-visualização</h3>
          <p className="muted">Conferes o Excel importado e, ao lado, exatamente como os lançamentos vão sair no TXT (2 linhas por movimento).</p>
          <div className="preview-panels">
            <div className="preview-panel">
              <h4 style={{marginTop:0}}>Excel importado</h4>
              <div className="table-wrap">
                <table className="excel-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th style={{textAlign:'right'}}>Montante</th>
                      <th>Sugestão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        <td>{startNumDiario + i}</td>
                        <td>{r.date.toISOString().slice(0,10)}</td>
                        <td>{r.description}</td>
                        <td style={{textAlign:'right'}}>{Math.abs(r.amount).toFixed(2)}</td>
                        <td>
                          {r.suggested ? (
                            <span>{r.suggested.name} <span className="muted">({r.suggestedScore}%)</span></span>
                          ) : <span className="muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 && <div className="muted" style={{marginTop:8}}>A mostrar só as primeiras 200 linhas.</div>}
            </div>

            <div className="preview-panel">
              <h4 style={{marginTop:0}}>Lançamentos gerados</h4>
              <div className="table-wrap">
                <table className="posting-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Data</th>
                      <th>Num. Doc</th>
                      <th>Conta</th>
                      <th>D/C</th>
                      <th style={{textAlign:'right'}}>Montante</th>
                      <th>Descrição</th>
                      <th>Linha TXT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {postingPreview.slice(0, 120).flatMap((entry) => ([
                      <tr key={`${entry.numDoc}-credit`}>
                        <td>{entry.numDiario}</td>
                        <td>{entry.dateISO}</td>
                        <td>{entry.numDoc}</td>
                        <td>{entry.credit.account}</td>
                        <td>{entry.credit.dc}</td>
                        <td style={{textAlign:'right'}}>{entry.credit.amount.toFixed(2)}</td>
                        <td>{entry.description}</td>
                        <td><code className="txt-line">{entry.credit.raw}</code></td>
                      </tr>,
                      <tr key={`${entry.numDoc}-debit`}>
                        <td>{entry.numDiario}</td>
                        <td>{entry.dateISO}</td>
                        <td>{entry.numDoc}</td>
                        <td>{entry.debit.account}</td>
                        <td>{entry.debit.dc}</td>
                        <td style={{textAlign:'right'}}>{entry.debit.amount.toFixed(2)}</td>
                        <td>{entry.description}</td>
                        <td><code className="txt-line">{entry.debit.raw}</code></td>
                      </tr>,
                    ]))}
                  </tbody>
                </table>
              </div>
              {postingPreview.length > 120 && <div className="muted" style={{marginTop:8}}>A mostrar lançamentos das primeiras 120 linhas importadas.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="muted" style={{marginTop:16}}>
        Dica: para novos modelos com variáveis, adiciona em <code>src/core/models.ts</code> uma entrada com <code>variables</code> e mapeia as contas no UI.
      </div>
    </div>
  )
}

export default App
