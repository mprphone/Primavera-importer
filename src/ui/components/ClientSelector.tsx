import React, { useEffect, useState } from 'react'
import { addCustomClient, ClientProfile, getAllClientProfiles, refreshCustomClientsFromServer } from '../../core/clients'
import { AddClientDialog } from './AddClientDialog'

export function ClientSelector({ onSelect }: { onSelect: (clientId: string) => void }) {
  const [clients, setClients] = useState<ClientProfile[]>(() => getAllClientProfiles())
  const [showAddClient, setShowAddClient] = useState(false)

  useEffect(() => {
    let cancelled = false
    refreshCustomClientsFromServer().then(remote => {
      if (!cancelled && remote) setClients(getAllClientProfiles())
    })
    return () => { cancelled = true }
  }, [])

  const createClient = async (profile: ClientProfile) => {
    await addCustomClient(profile)
    setClients(getAllClientProfiles())
    setShowAddClient(false)
    onSelect(profile.id)
  }

  return (
    <main className="client-selector">
      <div className="client-selector-heading">
        <span className="eyebrow">ERP Evolution Importer</span>
        <h1>Escolher empresa</h1>
        <p className="muted">Cada empresa mantém os seus modelos, contas, parâmetros e entidades separados.</p>
      </div>
      <div className="client-grid">
        {clients.map(client => (
          <button className="client-card" key={client.id} onClick={() => onSelect(client.id)}>
            <span className="client-monogram">{client.name.slice(0, 1)}</span>
            <span className="client-card-content">
              <strong>{client.name}</strong>
              <small>{client.legalName}</small>
              <span>NIF {client.nif} · {client.location}</span>
            </span>
            <span className="client-arrow">→</span>
          </button>
        ))}
        <button className="client-card add-client-card" onClick={() => setShowAddClient(true)}>
          <span className="client-monogram">+</span>
          <span className="client-card-content">
            <strong>Adicionar empresa</strong>
            <span>Cria um novo perfil de empresa</span>
          </span>
        </button>
      </div>
      {showAddClient && <AddClientDialog onClose={() => setShowAddClient(false)} onCreate={createClient} />}
    </main>
  )
}
