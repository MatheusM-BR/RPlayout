import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * De onde saiu esta build.
 *
 * Numa máquina de playout a interface é um arquivo estático servido pelo
 * próprio servidor; olhando a tela não dá para saber se ela foi construída
 * antes ou depois da última atualização do código. Sem esse carimbo, "está com
 * o layout antigo" vira meia hora de investigação.
 */
function carimbo(): string {
  try {
    const commit = execSync('git rev-parse --short HEAD').toString().trim()
    // Árvore suja quer dizer que o que está na tela não é exatamente o commit.
    const sujo = execSync('git status --porcelain').toString().trim() !== ''
    return sujo ? `${commit}+local` : commit
  } catch {
    // Cópia baixada como zip, sem git: melhor dizer isso do que mentir um hash.
    return 'sem git'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(carimbo()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  // Os pacotes do workspace são TypeScript cru; deixe o Vite transpilar em vez
  // de pré-empacotar.
  optimizeDeps: { exclude: ['@rplayout/protocol', '@rplayout/scheduler'] },
})
