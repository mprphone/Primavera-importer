import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './ui/App'
import './ui/styles.css'
import { FeedbackProvider } from './ui/feedback/FeedbackCenter'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // A aplicação continua operacional no navegador mesmo que este bloqueie service workers.
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeedbackProvider><App /></FeedbackProvider>
  </React.StrictMode>,
)
