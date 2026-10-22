import {useEffect,useState} from 'react'
import {api,type HaReplicationStatus,type HaMediaStatus,type HaAuthorityStatus} from '../../api.js'
import {HaBindingsPanel} from './HaBindingsPanel.js'
import {HaExecutionPanel} from './HaExecutionPanel.js'
import {HaReturnReceiptsPanel} from './HaReturnReceiptsPanel.js'
export function HaAuthority({authority}:{authority?:HaAuthorityStatus}){
  return <div aria-label="Concessão de publicação nativa" className="text-xs space-y-1">
    <p>{authority?.configured?'Testemunha configurada · concessão curta exigida no engine nativo. Perda da concessão encerra a publicação.':'Testemunha não configurada · espelho não fornece exclusividade de publicação.'}</p>
    {authority?.configured&&authority.leases.map(lease=><p key={lease.channelId}>{lease.channelId} · último termo confirmado pela testemunha: {lease.term||'nenhum'}{lease.error&&<span role="alert" className="text-armed-amber"> · {lease.error}</span>}</p>)}
    {authority?.configured&&authority.nodeAdmissionRequired&&<p>{authority.explicitTransferConfigured?'Controle de transferência configurado · retorno ao nó anterior exige transferência explícita.':'Controle de transferência não configurado · a chave do engine não permite trocar o nó admitido.'}</p>}
    <p className="text-outline">Confirmação da testemunha não comprova saída física, recuperação de playlist ou autorização de promoção.</p>
  </div>
}
export function HaMediaProgress({media}:{media:HaMediaStatus}){
  return <div aria-label="Cópias de mídia no reserva" className="text-xs space-y-1">
    <p>{media.enabled?`${media.verified} de ${media.required} arquivos com confirmação SHA de recebimento · limite ${media.mbit} Mbit/s`:'Cópia de mídia não configurada.'}</p>
    {media.quotaBytes!==undefined&&<p>Reserva de disco: {((media.bytesReserved??0)/1024**3).toFixed(2)} / {(media.quotaBytes/1024**3).toFixed(2)} GiB. Parciais também reservam quota.</p>}
    {media.error&&<p role="alert" className="text-armed-amber">{media.error}</p>}
    <p className="text-outline">{media.note}</p>
  </div>
}
export function HaReplicationPanel(){
  const [status,setStatus]=useState<HaReplicationStatus|null>(null),[error,setError]=useState<string|null>(null)
  useEffect(()=>{let active=true;const refresh=async()=>{try{const result=await api.haStatus();if(active){setStatus(result);setError(null)}}catch(error){if(active)setError(error instanceof Error?error.message:'Espelho indisponível.')}};void refresh();const timer=window.setInterval(()=>void refresh(),5000);return()=>{active=false;window.clearInterval(timer)}},[])
  return <section aria-label="Espelho de operação entre nós" className="rounded border border-border-subtle bg-surface-panel p-4 text-on-surface space-y-2">
    <h2 className="font-semibold">Espelho de operação entre nós</h2>
    {error&&<p role="alert" className="text-armed-amber">{error} Os dados podem estar desatualizados.</p>}
    {!status?<p className="text-sm">Consultando…</p>:!status.configured?<p className="text-sm">{status.reason}</p>:<>
      <p className="text-sm">{status.role==='PRIMARY'?'Primário':'Reserva sem PGM'} · {status.nodeId} → {status.peerNodeId} · sequência confirmada {status.sequence}</p>
      <p className="text-xs">Última confirmação: {status.confirmedAt?new Date(status.confirmedAt).toLocaleString('pt-BR'):'nenhuma'} · {status.pending?'pedido aguardando confirmação':'sem pedido pendente'}</p>
      {status.role==='STANDBY'&&<p className="text-xs">{status.mirroredChannels} canais e {status.mirroredAsRun} registros as-run no espelho.</p>}
      <HaMediaProgress media={status.media}/>
      <HaAuthority authority={status.authority}/>
      {status.role==='STANDBY'&&<HaBindingsPanel/>}
      {status.role==='STANDBY'&&<HaExecutionPanel/>}
      {status.role==='PRIMARY'&&<HaReturnReceiptsPanel stale={!!error}/>}
      {status.error&&<p role="alert" className="text-armed-amber text-xs">{status.error}</p>}
      <p className="text-armed-amber text-xs">{status.reason}</p>
    </>}
    <p className="text-xs text-outline">Cópia de estado não autoriza assumir o canal. Não há promoção automática ou botão de takeover habilitado nesta etapa.</p>
  </section>
}
