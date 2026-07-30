import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ComplexApp } from './ComplexApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComplexApp />
  </StrictMode>,
)
