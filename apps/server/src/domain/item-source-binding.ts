import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {liveSources} from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'

type Reader = Pick<Db, 'select'>
export function configuredSourceEndpoint(source: {kind: string; targetUrl: string}): string {
  const prefix = source.kind.toLowerCase() + ':'
  return ['NDI', 'OMT', 'SDI'].includes(source.kind) && !source.targetUrl.startsWith(prefix)
    ? prefix + source.targetUrl : source.targetUrl
}

/** Transactional authorization/connection check, not discovery or signal proof.
 * Deleted/disabled/reconfigured selections require an explicit new choice.
 * Published items keep their frozen endpoint, not a mutable catalog lookup. */
export function requireItemSourceBinding(db: Reader, channelId: string, id: string, endpoint: string | null | undefined, type: string) {
  const source = db.select().from(liveSources).where(eq(liveSources.id, id)).get()
  if (!source || source.channelId !== channelId) throw new CollaborativeEditError(400, {error: 'Entrada selecionada indisponível neste canal. Atualize a lista e selecione novamente.'})
  if (type !== 'LIVE' || !source.enabled || configuredSourceEndpoint(source) !== endpoint) throw new CollaborativeEditError(409, {error: 'A conexão da entrada selecionada mudou ou foi desativada. Atualize a lista e selecione novamente.'})
  return source
}
