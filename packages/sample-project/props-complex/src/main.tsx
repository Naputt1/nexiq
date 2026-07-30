import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ComplexProps } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComplexProps a="hello" b={{ x: 1, y: 2 }} c="world" />
  </StrictMode>,
)
