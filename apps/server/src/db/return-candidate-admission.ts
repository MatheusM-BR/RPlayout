import type Database from 'better-sqlite3'
/** A return candidate is not an ordinary operational installation. The future
 * explicit return workflow must materialize/validate bindings and authority in
 * another derivative; generic bootstrap cannot adopt this staging database. */
export function assertNoUnboundReturnCandidate(sqlite:Database.Database){
  if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('ha_return_candidate_origin','ha_return_bound_origin','ha_return_media_origin')").get())throw new Error('Banco de candidato HA isolado: partida operacional bloqueada. Use o fluxo explícito de revisão, vínculos locais e autoridade de retorno; não apague a proveniência para liberar operação.')
}
