import React, { useState } from 'react'
import { baseConfigurableModel, ClientProfile, nextClientId, PrimaveraConnectionMode, VatRegime } from '../../core/clients'

type Props = {
  profile?: ClientProfile
  onClose: () => void
  onSave: (profile: ClientProfile) => void
}

export function AddClientDialog({ profile, onClose, onSave }: Props) {
  const editing = Boolean(profile)
  const [name, setName] = useState(profile?.name ?? '')
  const [legalName, setLegalName] = useState(profile?.legalName ?? '')
  const [nif, setNif] = useState(profile?.nif ?? '')
  const [location, setLocation] = useState(profile?.location ?? '')
  const [primaveraCompanyCode, setPrimaveraCompanyCode] = useState(profile?.primaveraCompanyCode ?? '')
  const [connectionMode, setConnectionMode] = useState<PrimaveraConnectionMode>(profile?.connectionMode ?? 'txt')
  const [vatRegime, setVatRegime] = useState<VatRegime>(profile?.vatRegime ?? 'normal')
  const [diario, setDiario] = useState(profile?.defaults.diario ?? '')
  const [documento, setDocumento] = useState(profile?.defaults.documento ?? '')
  const [startNumDiario, setStartNumDiario] = useState(profile?.defaults.startNumDiario ?? 1)
  const [error, setError] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('O nome da empresa é obrigatório.')
    if (!nif.trim()) return setError('O NIF é obrigatório.')
    if (!primaveraCompanyCode.trim()) return setError('O código da empresa no ERP Evolution é obrigatório.')

    onSave({
      id: profile?.id ?? nextClientId(name),
      name: name.trim(),
      legalName: legalName.trim() || name.trim(),
      nif: nif.trim(),
      location: location.trim(),
      primaveraCompanyCode: primaveraCompanyCode.trim().toUpperCase(),
      connectionMode,
      vatRegime,
      defaults: { diario: diario.trim(), documento: documento.trim(), startNumDiario: Math.max(1, startNumDiario || 1) },
      models: profile?.models ?? [baseConfigurableModel],
    })
  }

  return (
    <div className="module-modal-backdrop" onClick={onClose}>
      <form className="module-modal client-profile-dialog" onSubmit={submit} onClick={event => event.stopPropagation()}>
        <button type="button" className="module-modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">ERP Evolution Importer</span>
        <h2>{editing ? 'Editar empresa' : 'Adicionar empresa'}</h2>
        <p className="muted">{editing
          ? 'A alteração dos dados não muda o identificador interno nem o histórico desta empresa.'
          : 'Cria um espaço independente para modelos, contas, compras e reconciliações.'}</p>

        <section className="client-form-section">
          <div className="client-form-section-heading"><strong>Identificação</strong><span>Dados apresentados no menu de empresas</span></div>
          <div className="add-client-grid">
            <label>Nome curto<input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Padaria do Bairro" autoFocus /></label>
            <label>Designação legal<input value={legalName} onChange={event => setLegalName(event.target.value)} placeholder="Ex.: Padaria do Bairro, Lda." /></label>
            <label>NIF<input value={nif} onChange={event => setNif(event.target.value)} inputMode="numeric" /></label>
            <label>Localização<input value={location} onChange={event => setLocation(event.target.value)} placeholder="Localidade ou sede" /></label>
          </div>
        </section>

        <section className="client-form-section">
          <div className="client-form-section-heading"><strong>ERP e fiscalidade</strong><span>Parâmetros usados na ligação e nos documentos</span></div>
          <div className="add-client-grid">
            <label>Código no ERP Evolution<input value={primaveraCompanyCode} onChange={event => setPrimaveraCompanyCode(event.target.value)} placeholder="Ex.: CEV" /></label>
            <label>Modo de ligação
              <select value={connectionMode} onChange={event => setConnectionMode(event.target.value as PrimaveraConnectionMode)}>
                <option value="txt">Exportação por TXT</option>
                <option value="direct">SQL direto</option>
              </select>
            </label>
            <label>Regime de IVA
              <select value={vatRegime} onChange={event => setVatRegime(event.target.value as VatRegime)}>
                <option value="normal">Regime normal</option>
                <option value="isento">Sem direito à dedução</option>
              </select>
            </label>
          </div>
        </section>

        <section className="client-form-section">
          <div className="client-form-section-heading"><strong>Valores por defeito</strong><span>Podem ser afinados posteriormente nas Configurações</span></div>
          <div className="add-client-grid client-defaults-grid">
            <label>Diário<input value={diario} onChange={event => setDiario(event.target.value)} /></label>
            <label>Documento<input value={documento} onChange={event => setDocumento(event.target.value)} /></label>
            <label>Número inicial<input type="number" min="1" value={startNumDiario} onChange={event => setStartNumDiario(Number(event.target.value))} /></label>
          </div>
        </section>

        {error && <div className="notice">{error}</div>}
        <div className="action-row">
          <button type="submit">{editing ? 'Guardar alterações' : 'Criar empresa'}</button>
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
