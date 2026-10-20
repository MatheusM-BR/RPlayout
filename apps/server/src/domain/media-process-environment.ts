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
  return result
}
