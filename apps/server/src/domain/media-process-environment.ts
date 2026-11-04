/** Native media helpers need runtime paths/encoder choice, not administrator,
 * vault, service or output credentials inherited from the owning server. */
export function mediaProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nativeSettings = new Set(['RPLAYOUT_OMT_RUNTIME', 'RPLAYOUT_ENCODER'])
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !key.toUpperCase().startsWith('RPLAYOUT_') || nativeSettings.has(key.toUpperCase())))
}

/** MediaMTX reads current MTX_* and legacy RTSP_* settings after its YAML,
 * including CONFKEY, path hooks and listener/auth overrides. The owned broker
 * must use only the private configuration we admitted. Scope this filtering
 * to the broker; other native helpers retain their existing runtime settings.
 * Do not modify process.env or log the discarded values. */
export function mediaMtxProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(mediaProcessEnvironment(environment))
    .filter(([key]) => !/^(MTX|RTSP)_/i.test(key)))
}

/** Decode acceleration belongs to the playout engine only. Keep software as
 * the default and admit precisely the qualified opt-in understood by Rust;
 * don't widen the shared helper allowlist or forward arbitrary values. */
export function engineProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result = mediaProcessEnvironment(environment)
  const choice = Object.entries(environment).find(([key]) => key.toUpperCase() === 'RPLAYOUT_HARDWARE_DECODE')?.[1]
  if (choice === '1') result.RPLAYOUT_HARDWARE_DECODE = '1'
  // Ingest único por entrada (receptor compartilhado): só os valores que o
  // engine entende; nada mais do ambiente do servidor passa.
  const value = (name: string) => Object.entries(environment).find(([key]) => key.toUpperCase() === name)?.[1]?.trim()
  const shared = value('RPLAYOUT_INGEST_SHARED')
  if (shared === '0' || shared === '1') result.RPLAYOUT_INGEST_SHARED = shared
  for (const [name, max] of [['RPLAYOUT_INGEST_LINGER_MS', 60_000], ['RPLAYOUT_INGEST_ITEM_LATENCY_MS', 500]] as const) {
    const ms = value(name)
    if (ms && /^\d{1,6}$/.test(ms) && Number(ms) <= max) result[name] = ms
  }
  // A Rust panic then prints where it happened; the crash report keeps it.
  result.RUST_BACKTRACE ??= '1'
  return result
}
