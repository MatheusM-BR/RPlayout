import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// O pacote de operação não executa TypeScript e não depende de tsx/pnpm.
// better-sqlite3 contém um módulo nativo (.node), portanto fica externo ao
// bundle e é levado pelo `pnpm deploy --prod` durante o empacotamento.
await build({
  absWorkingDir: root,
  entryPoints: ['apps/server/src/index.ts'],
  outfile: 'apps/server/dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['better-sqlite3'],
  logLevel: 'info',
})
await build({
  absWorkingDir: root,
  entryPoints: ['apps/server/src/schedule-planner.ts'],
  outfile: 'apps/server/dist/schedule-planner.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'info',
})
await build({
  absWorkingDir: root, entryPoints: ['apps/server/src/ha-witness.ts'],
  outfile: 'apps/server/dist/ha-witness.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node24',
  external: ['better-sqlite3'], logLevel: 'info',
})
