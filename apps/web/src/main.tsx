import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { BUILD_COMMIT, buildDate } from './build.js'
import './styles.css'

// Primeira linha do console: de qual código esta tela saiu. É a resposta para
// "construí de novo e continua igual" sem precisar abrir nada.
console.info(
  `RPlayout · interface build ${BUILD_COMMIT}${buildDate() !== '' ? ` · ${buildDate()}` : ''}`,
)

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não existe no documento.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
