import type {Channel} from '@rplayout/protocol'
import {InterruptedItemsBanner} from './InterruptedItemsBanner.js'

/** Recovery must remain reachable when a durable fence prevented engine startup. */
export function UnavailableChannelReturns({channels}:{channels:readonly Channel[]}){
  if(!channels.length)return null
  return <section aria-label="Retornos pendentes dos canais" className="mt-4 text-left">
    <p className="hint">Uma pendência de retorno pode impedir a abertura do engine. Confira abaixo; encerrá-la não inicia o PGM nem repete TAKE. Processos anteriores ativos ou desconhecidos não são liberados automaticamente.</p>
    {channels.map(channel=><div key={channel.id} className="mt-3">
      <h2 className="text-sm">{channel.name}</h2>
      <InterruptedItemsBanner channelId={channel.id} rate={channel.rate}/>
    </div>)}
  </section>
}
