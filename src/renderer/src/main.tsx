// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/shell.css'
import App from './App'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
