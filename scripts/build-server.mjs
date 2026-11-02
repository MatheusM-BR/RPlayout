import { build as buildRaw } from 'esbuild'
import {writeBundleNotices} from './bundle-notices.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// An explicit output location lets a build avoid a full system drive without
// moving source, deleting releases or changing normal package startup paths.
const serverDist = process.env.RPLAYOUT_SERVER_BUILD_DIR
  ? resolve(process.env.RPLAYOUT_SERVER_BUILD_DIR) : resolve(root, 'apps/server/dist')

async function build(options){
  const result=await buildRaw({...options,metafile:true})
  await writeBundleNotices(result,{...options,noticeOverridesDirectory:process.env.RPLAYOUT_NOTICE_OVERRIDE_DIR})
  return result
}

await build({absWorkingDir:root,entryPoints:['apps/server/src/rollback-contract.ts'],outfile:resolve(serverDist,'rollback-contract.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',logLevel:'info'})
await build({absWorkingDir:root,entryPoints:['apps/server/src/prepare-compatible-rollback.ts'],outfile:resolve(serverDist,'prepare-compatible-rollback.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['better-sqlite3'],logLevel:'info'})

await build({absWorkingDir:root,entryPoints:['apps/server/src/review-rollback.ts'],outfile:resolve(serverDist,'review-rollback.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['better-sqlite3'],logLevel:'info'})
await build({absWorkingDir:root,entryPoints:['apps/server/src/migrate-restored.ts'],outfile:resolve(serverDist,'migrate-restored.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['better-sqlite3'],logLevel:'info'})
await build({absWorkingDir:root,entryPoints:['apps/server/src/reconcile-upgrade-profile.ts'],outfile:resolve(serverDist,'reconcile-upgrade-profile.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['better-sqlite3'],logLevel:'info'})

await build({absWorkingDir:root,entryPoints:['apps/server/src/ha-return-review-worker.ts'],outfile:resolve(serverDist,'ha-return-review-worker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['better-sqlite3'],logLevel:'info'})
for (const entry of ['storage-service','storage-bridge']) {
  await build({
    absWorkingDir: root, entryPoints: [`apps/server/src/db/${entry}.ts`],
    outfile: resolve(serverDist, `${entry}.cjs`), bundle: true,
    platform: 'node', format: 'cjs', target: 'node24',
    external: ['better-sqlite3'], logLevel: 'info',
  })
}

await build({
  absWorkingDir: root, entryPoints: ['apps/server/src/recover-restored-reservation.ts'],
  outfile: resolve(serverDist, 'recover-restored-reservation.cjs'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node24',
  external: ['better-sqlite3'], logLevel: 'info',
})

// O pacote de operação não executa TypeScript e não depende de tsx/pnpm.
// better-sqlite3 contém um módulo nativo (.node), portanto fica externo ao
// bundle e é levado pelo `pnpm deploy --prod` durante o empacotamento.
await build({
  absWorkingDir: root,
  entryPoints: ['apps/server/src/index.ts'],
  outfile: resolve(serverDist, 'server.cjs'),
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
  outfile: resolve(serverDist, 'schedule-planner.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'info',
})
await build({
  absWorkingDir: root, entryPoints: ['apps/server/src/ha-witness.ts'],
  outfile: resolve(serverDist, 'ha-witness.cjs'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node24',
  external: ['better-sqlite3'], logLevel: 'info',
})
await build({
  absWorkingDir: root, entryPoints: ['apps/server/src/restore-backup.ts'],
  outfile: resolve(serverDist, 'restore-backup.cjs'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node24',
  external: ['better-sqlite3'], logLevel: 'info',
})
await build({
  absWorkingDir: root, entryPoints: ['apps/server/src/review-restored.ts'],
  outfile: resolve(serverDist, 'review-restored.cjs'), bundle: true,
  platform: 'node', format: 'cjs', target: 'node24',
  external: ['better-sqlite3'], logLevel: 'info',
})
