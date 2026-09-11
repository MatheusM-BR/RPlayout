import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * De onde saiu esta build.
 *
 * Numa máquina de playout a interface é um arquivo estático servido pelo
 * próprio servidor; olhando a tela não dá para saber se ela foi construída
 * antes ou depois da última atualização do código. Sem esse carimbo, "está com
 * o layout antigo" vira meia hora de investigação.
 */
function commitCru(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    // Cópia baixada como zip, sem git: melhor dizer isso do que mentir um hash.
    return 'sem git'
  }
}

/** Alteração não commitada: o que está na tela não é exatamente o commit. */
function arvoreSuja(): boolean {
  try {
    return execSync('git status --porcelain').toString().trim() !== ''
  } catch {
    return false
  }
}

function carimbo(): string {
  const commit = commitCru()
  if (commit === 'sem git') return commit
  return arvoreSuja() ? `${commit}+local` : commit
}

/**
 * Deixa em `dist/build.json` de qual commit esta build saiu.
 *
 * O carimbo na tela responde a quem já está olhando; este arquivo responde a
 * quem ainda não abriu nada. É o que deixa o lançador comparar, antes de subir
 * o servidor, a interface construída com o código que está na pasta -- e gritar
 * quando são de épocas diferentes, que é o erro que ninguém desconfia porque a
 * tela antiga funciona perfeitamente.
 */
function carimboEmArquivo(): Plugin {
  return {
    name: 'rplayout-carimbo',
    apply: 'build',
    writeBundle(options) {
      const destino = options.dir ?? resolve('dist')
      const conteudo = {
        commit: commitCru(),
        sujo: arvoreSuja(),
        hora: new Date().toISOString(),
      }
      try {
        mkdirSync(destino, { recursive: true })
        writeFileSync(resolve(destino, 'build.json'), JSON.stringify(conteudo, null, 2))
      } catch {
        // Não poder gravar o carimbo não é motivo para falhar a build.
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), carimboEmArquivo()],
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
