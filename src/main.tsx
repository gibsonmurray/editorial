import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import AuthGate from '@/components/AuthGate'
import { inject as injectAnalytics } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'

injectAnalytics()
injectSpeedInsights()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
)
