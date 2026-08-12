import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type FeedbackKind = 'success' | 'info' | 'warning' | 'error'
type Feedback = { id: number; kind: FeedbackKind; title: string; detail?: string; progress?: number }
type FeedbackApi = { notify: (item: Omit<Feedback, 'id'>) => number; dismiss: (id: number) => void }

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Feedback[]>([])
  const dismiss = useCallback((id: number) => setItems(current => current.filter(item => item.id !== id)), [])
  const notify = useCallback((item: Omit<Feedback, 'id'>) => {
    const id = Date.now() + Math.random()
    setItems(current => [...current.slice(-3), { ...item, id }])
    if (item.progress === undefined && item.kind !== 'error') window.setTimeout(() => dismiss(id), 5000)
    return id
  }, [dismiss])
  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss])
  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <aside className="feedback-center" aria-live="polite" aria-label="Notificações">
        {items.map(item => (
          <article key={item.id} className={`feedback-item ${item.kind}`}>
            <div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</div>
            <button type="button" onClick={() => dismiss(item.id)} aria-label="Fechar notificação">×</button>
            {item.progress !== undefined && <progress max="100" value={item.progress}>{item.progress}%</progress>}
          </article>
        ))}
      </aside>
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback deve ser usado dentro de FeedbackProvider')
  return value
}
