import React, { useState } from 'react'
import { baseConfigurableModel, ClientProfile, nextClientId, PrimaveraConnectionMode, VatRegime } from '../../core/clients'

type Props = {
  onClose: () => void
  onCreate: (profile: ClientProfile) => void
}

export function AddClientDialog({ onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [nif, setNif] = useState('')
  const [location, setLocation] = useState('')
  const [primaveraCompanyCode, setPrimaveraCompanyCode] = useState('')
  const [connectionMode, setConnectionMode] = useState<PrimaveraConnectionMode>('txt')
  const [vatRegime, setVatRegime] = useState<VatRegime>('normal')
  const [diario, setDiario] = useState('')
  const [documento, setDocumento] = useState('')
  const [startNumDiario, setStartNumDiario] = useState(1)
  const [error, setError] = useState('')

  const submit = () => {
    if (!name.trim()) return setError('O nome da empresa é obrigatório.')
    if (!nif.trim()) return setError('O NIF é obrigatório.')
    if (!primaveraCompanyCode.trim()) return setError('O código da empresa no ERP Evolution é obrigatório.')

    onCreate({
      id: nextClientId(name),
      name: name.trim(),
      legalName: legalName.trim() || name.trim(),
      nif: nif.trim(),
      location: location.trim(),
      primaveraCompanyCode: primaveraCompanyCode.trim(),
      connectionMode,
      vatRegime,
      defaults: { diario: diario.trim(), documento: documento.trim(), startNumDiario },
      models: [baseConfigurableModel],
    })
  }

  return (
    <div className="module-modal-backdrop" onClick={onClose}>
      <div className="module-modal" onClick={event => event.stopPropagation()}>
        <button className="module-modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">ERP Evolution Importer</span>
        <h2>Adicionar empresa</h2>
        <p className="muted">Os modelos de lançamento e contas concretas configuram-se depois, em Configurações.</p>
        <div className="add-client-grid">
          <label className="span-2">Nome<input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Padaria do Bairro" /></label>
          <label>Nome legal<input value={legalName} onChange={event => setLegalName(event.target.value)} placeholder="Ex.: Padaria do Bairro Lda" /></label>
          <label>NIF<input value={nif} onChange={event => setNif(event.target.value)} /></label>
          <label>Localização<input value={location} onChange={event => setLocation(event.target.value)} /></label>
          <label>Código da empresa no ERP Evolution<input value={primaveraCompanyCode} onChange={event => setPrimaveraCompanyCode(event.target.value)} /></label>
          <label>Modo de ligação
            <select value={connectionMode} onChange={event => setConnectionMode(event.target.value as PrimaveraConnectionMode)}>
              <option value="txt">Exportação por TXT</option>
              <option value="direct">SQL direto</option>
            </select>
          </label>
          <label>Regime de IVA
            <select value={vatRegime} onChange={event => setVatRegime(event.target.value as VatRegime)}>
              <option value="normal">Normal</option>
              <option value="isento">Sem direito à dedução de IVA</option>
            </select>
          </label>
          <label>Diário por defeito<input value={diario} onChange={event => setDiario(event.target.value)} /></label>
          <label>Documento por defeito<input value={documento} onChange={event => setDocumento(event.target.value)} /></label>
          <label>Número inicial<input type="number" value={startNumDiario} onChange={event => setStartNumDiario(Number(event.target.value))} /></label>
        </div>
        {error && <div className="notice">{error}</div>}
        <div className="action-row">
          <button onClick={submit}>Criar empresa</button>
          <button className="ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
