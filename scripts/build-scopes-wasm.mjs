#!/usr/bin/env node
// Compila apps/engine/scopes para wasm32-unknown-unknown e copia o .wasm para
// a interface (apps/web/src/scopes/rplayout_scopes.wasm).
//
// O .wasm fica versionado: o build do Windows (scripts/build-r88.ps1) não
// precisa do alvo wasm32 instalado. Para não ficar velho sem ninguém ver, o
// manifesto ao lado guarda o SHA-256 das fontes do crate; `--check` (rodado
// pelo vitest e pelo build-r88) falha se as fontes mudaram e o .wasm não.
//
// Uso:
//   node scripts/build-scopes-wasm.mjs            compila e atualiza
//   node scripts/build-scopes-wasm.mjs --check    só confere se está em dia
//   node scripts/build-scopes-wasm.mjs --if-stale compila só se estiver velho
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {copyFileSync, readFileSync, readdirSync, writeFileSync, existsSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'apps/engine/scopes')
const outDir = join(root, 'apps/web/src/scopes')
const wasmOut = join(outDir, 'rplayout_scopes.wasm')
const manifestPath = join(outDir, 'rplayout_scopes.wasm.json')

/** SHA-256 das fontes que definem o .wasm (finais de linha normalizados). */
export function sourceHash() {
  const hash = createHash('sha256')
  const files = ['Cargo.toml', ...readdirSync(join(crate, 'src')).filter(f => f.endsWith('.rs') && f !== 'tests.rs').sort().map(f => `src/${f}`)]
  for (const file of files) {
    hash.update(file + '\0')
    hash.update(readFileSync(join(crate, file), 'utf8').replace(/\r\n/g, '\n'))
  }
  return hash.digest('hex')
}

function readManifest() {
  try { return JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { return null }
}

export function isFresh() {
  const manifest = readManifest()
  if (!manifest || !existsSync(wasmOut)) return false
  const wasmSha = createHash('sha256').update(readFileSync(wasmOut)).digest('hex')
  return manifest.sourceHash === sourceHash() && manifest.wasmSha256 === wasmSha
}

function build() {
  const target = join(root, 'apps/engine/target/scopes-wasm')
  execFileSync('cargo', ['rustc', '--release', '--lib', '--target', 'wasm32-unknown-unknown', '--crate-type', 'cdylib', '--manifest-path', join(crate, 'Cargo.toml'), '--target-dir', target], {
    stdio: 'inherit',
    env: {...process.env, CARGO_PROFILE_RELEASE_OPT_LEVEL: '3', CARGO_PROFILE_RELEASE_LTO: 'true', CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '1', CARGO_PROFILE_RELEASE_PANIC: 'abort', CARGO_PROFILE_RELEASE_STRIP: 'true', CARGO_PROFILE_RELEASE_DEBUG: 'false'},
  })
  copyFileSync(join(target, 'wasm32-unknown-unknown/release/rplayout_scopes.wasm'), wasmOut)
  const wasm = readFileSync(wasmOut)
  const manifest = {
    note: 'Gerado por scripts/build-scopes-wasm.mjs. Não edite: recompile.',
    sourceHash: sourceHash(),
    wasmSha256: createHash('sha256').update(wasm).digest('hex'),
    bytes: wasm.length,
    abi: 1,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`rplayout_scopes.wasm: ${wasm.length} bytes`)
}

const mode = process.argv[2]
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-scopes-wasm.mjs')) {
  if (mode === '--check') {
    if (!isFresh()) { console.error('rplayout_scopes.wasm está desatualizado em relação a apps/engine/scopes. Rode: node scripts/build-scopes-wasm.mjs'); process.exit(1) }
    console.log('rplayout_scopes.wasm em dia')
  } else if (mode === '--if-stale') {
    if (isFresh()) console.log('rplayout_scopes.wasm em dia')
    else build()
  } else build()
}
