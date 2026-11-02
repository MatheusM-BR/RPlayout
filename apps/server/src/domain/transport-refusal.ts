import { EngineCommandRejected } from './engine.js'
import { MediaVersionError } from './file-version.js'
/** Classifica a falha de um comando de transporte. Recusa do engine e mídia
 * alterada são conflito (409); pré-condição da mídia/canal é 422; engine fora
 * do ar é 503. Só um erro sem mensagem (bug) segue como 500. */
export function transportRefusalStatus(error: unknown, engineReady: boolean): 409 | 422 | 503 | null {
  if (error instanceof EngineCommandRejected || error instanceof MediaVersionError) return 409
  if (!(error instanceof Error) || !error.message) return null
  // Erros que já carregam o próprio status HTTP seguem o tratamento global.
  const carried = error as { status?: unknown; statusCode?: unknown }
  if (typeof carried.status === 'number' || typeof carried.statusCode === 'number') return null
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) return null
  return engineReady ? 422 : 503
}
