import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CardBody from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CardBody expanded={true}>
      <p>Content</p>
    </CardBody>
  </StrictMode>,
)
