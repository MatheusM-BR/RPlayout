/** Native media helpers need runtime paths/encoder choice, not administrator,
 * vault, service or output credentials inherited from the owning server. */
export function mediaProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nativeSettings = new Set(['RPLAYOUT_OMT_RUNTIME', 'RPLAYOUT_ENCODER'])
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !key.toUpperCase().startsWith('RPLAYOUT_') || nativeSettings.has(key.toUpperCase())))
}
