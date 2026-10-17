import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

// Dev-only import-screen fixtures (no API, no LLM). `import.meta.env.DEV` is a build-time
// constant, so this whole branch, including the dynamic import, is removed from production.
const fixture = import.meta.env.DEV ? new URLSearchParams(location.search).get('importFixture') : null

if (import.meta.env.DEV && fixture) {
  void import('./import/devFixtures').then((m) => m.mountImportFixture(root, fixture))
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
