import React from 'react'

export type AppTab = 'import' | 'purchases' | 'control' | 'banking' | 'exceptions' | 'automation' | 'settings'

const tabs: Array<{ id: AppTab; label: string }> = [
  { id: 'import', label: 'Importação' },
  { id: 'purchases', label: 'Compras' },
  { id: 'control', label: 'Controlo' },
  { id: 'banking', label: 'Bancos' },
  { id: 'exceptions', label: 'Exceções' },
  { id: 'automation', label: 'Fecho mensal' },
  { id: 'settings', label: 'Configurações' },
]

export function AppTabs({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  return (
    <nav className="app-tabs" aria-label="Área da empresa">
      {tabs.map(tab => (
        <button key={tab.id} className={active === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
