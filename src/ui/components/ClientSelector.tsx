import React, { useEffect, useMemo, useState } from 'react'
import { addCustomClient, ClientProfile, getAllClientProfiles, refreshCustomClientsFromServer, updateClientProfile } from '../../core/clients'
import { loadClientSettings, saveClientSettings } from '../../core/client-settings'
import { AddClientDialog } from './AddClientDialog'

export function ClientSelector({ onSelect }: { onSelect: (clientId: string) => void }) {
  const [clients, setClients] = useState<ClientProfile[]>(() => getAllClientProfiles())
  const [showAddClient, setShowAddClient] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(true)

  useEffect(() => {
    let cancelled = false
    refreshCustomClientsFromServer().then(remote => {
      if (!cancelled && remote) setClients(getAllClientProfiles())
    }).finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [])

  const visibleClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-PT')
    if (!query) return clients
    return clients.filter(client => [client.name, client.legalName, client.nif, client.location, client.primaveraCompanyCode]
      .some(value => value.toLocaleLowerCase('pt-PT').includes(query)))
  }, [clients, search])

  const createClient = async (profile: ClientProfile) => {
    await addCustomClient(profile)
    setClients(getAllClientProfiles())
    setShowAddClient(false)
    onSelect(profile.id)
  }

  const openEditor = (client: ClientProfile) => {
    const settings = loadClientSettings(client)
    setEditingClient({
      ...client,
      primaveraCompanyCode: settings.primaveraCompanyCode,
      connectionMode: settings.connectionMode,
      vatRegime: settings.vatRegime,
      defaults: {
        diario: settings.diario,
        documento: settings.documento,
        startNumDiario: settings.startNumDiario,
      },
    })
  }

  const saveEditedClient = async (profile: ClientProfile) => {
    if (!editingClient) return
    const currentSettings = loadClientSettings(editingClient)
    await updateClientProfile(profile)
    saveClientSettings(profile.id, {
      ...currentSettings,
      primaveraCompanyCode: profile.primaveraCompanyCode,
      connectionMode: profile.connectionMode,
      vatRegime: profile.vatRegime,
      financasUser: currentSettings.financasUser === editingClient.nif ? profile.nif : currentSettings.financasUser,
      diario: profile.defaults.diario,
      documento: profile.defaults.documento,
      startNumDiario: profile.defaults.startNumDiario,
    })
    setClients(getAllClientProfiles())
    setEditingClient(null)
  }

  return (
    <main className="client-selector">
      <div className="client-selector-heading">
        <div>
          <span className="eyebrow">ERP Evolution Importer</span>
          <h1>Empresas</h1>
          <p className="muted">Escolha o ambiente onde pretende trabalhar. Os dados contabilísticos permanecem separados por empresa.</p>
        </div>
        <div className="client-heading-summary">
          <span><strong>{clients.length}</strong><small>empresas configuradas</small></span>
          <span className={`client-sync-state${syncing ? ' syncing' : ''}`}><i />{syncing ? 'A sincronizar…' : 'Dados sincronizados'}</span>
          <button type="button" onClick={() => setShowAddClient(true)}>+ Nova empresa</button>
        </div>
      </div>

      <section className="client-selector-toolbar" aria-label="Pesquisa de empresas">
        <div><strong>Escolher empresa</strong><span>{visibleClients.length === clients.length ? 'Todas as empresas disponíveis' : `${visibleClients.length} resultado(s)`}</span></div>
        <label>
          <span className="sr-only">Pesquisar empresa</span>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Pesquisar nome, NIF, localidade ou código ERP…" />
        </label>
      </section>

      <div className="company-grid">
        {visibleClients.map(client => (
          <article className="company-card" key={client.id}>
            <button type="button" className="company-card-main" onClick={() => onSelect(client.id)}>
              <span className="company-monogram">{client.name.trim().slice(0, 1).toUpperCase() || 'E'}</span>
              <span className="company-card-content">
                <strong>{client.name}</strong>
                <small>{client.legalName}</small>
                <span className="company-details">NIF {client.nif}{client.location ? ` · ${client.location}` : ''}</span>
                <span className="company-tags">
                  <em>ERP {client.primaveraCompanyCode}</em>
                  <em>{client.vatRegime === 'isento' ? 'IVA sem dedução' : 'IVA normal'}</em>
                </span>
              </span>
              <span className="company-enter">Entrar <b>→</b></span>
            </button>
            <button type="button" className="company-edit-button" onClick={() => openEditor(client)} aria-label={`Editar dados de ${client.name}`} title="Editar dados da empresa">
              <span aria-hidden="true">✎</span> Editar
            </button>
          </article>
        ))}
        {!visibleClients.length && (
          <div className="company-search-empty">
            <strong>Nenhuma empresa encontrada</strong>
            <span>Experimente pesquisar por outro nome, NIF ou código ERP.</span>
          </div>
        )}
        <button type="button" className="company-add-card" onClick={() => setShowAddClient(true)}>
          <span className="company-add-icon">+</span>
          <span><strong>Adicionar empresa</strong><small>Criar um novo ambiente independente</small></span>
        </button>
      </div>

      {showAddClient && <AddClientDialog onClose={() => setShowAddClient(false)} onSave={createClient} />}
      {editingClient && <AddClientDialog key={editingClient.id} profile={editingClient} onClose={() => setEditingClient(null)} onSave={saveEditedClient} />}
    </main>
  )
}
