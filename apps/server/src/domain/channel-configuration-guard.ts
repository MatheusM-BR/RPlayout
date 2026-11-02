import {channelConfigurationETag} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {CollaborativeEditError} from './collaborative-edit.js'

/** Use only the revision originally read; never replace it with a fresh read
 * to authorize a stale draft. Call inside the write/read transaction. */
export function requireChannelConfiguration(db:Pick<Db,'select'>,id:string,header:string|string[]|undefined):number{
  if(header===undefined)throw new CollaborativeEditError(428,{error:'Confira a configuração antes de alterar. Informe o If-Match recebido em /api/channels/:id/configuration; nenhum dado foi alterado.'})
  const match=typeof header==='string'?/^"channel:([^"\s]+):([1-9]\d*)"$/.exec(header):null
  const expected=match?Number(match[2]):NaN
  if(!Number.isSafeInteger(expected) || expected<1 || header!==channelConfigurationETag(id,expected))throw new CollaborativeEditError(400,{error:'Revisão de configuração inválida ou de outro canal. Reabra o canal correto.'})
  const current=configurationRevision(db,id)
  if(current!==expected)throw new CollaborativeEditError(409,{error:'A configuração ou uma saída mudou desde a abertura. Seus campos não foram aplicados; confira a configuração atual antes de repetir.',configurationRevision:current})
  return current
}
