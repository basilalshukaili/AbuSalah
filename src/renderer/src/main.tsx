import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/globals.css'
import './i18n'
// Installs the authenticated HTTP implementation of window.api when this
// renderer is opened by a normal browser. In Electron, the preload API wins.
import './lib/api'

import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
