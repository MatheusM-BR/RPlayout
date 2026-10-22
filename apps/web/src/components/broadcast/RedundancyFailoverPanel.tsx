import {useState} from 'react'
import type {RedundantStreamPair} from '@rplayout/protocol'
interface Props {pair?:RedundantStreamPair;onSwitchStream?:(target:'PRIMARY'|'BACKUP')=>void|Promise<void>;onToggleAutoFailover?:(enabled:boolean)=>void;onMessage?:(message:string)=>void}
// A source pair is not two channel engines. The existing API records metadata,
// not a PGM switch. Do not render fake authority, heartbeat or armed failover.
export function RedundancyFailoverPanel({pair,onSwitchStream,onMessage}:Props){
  const [pending,setPending]=useState(false)
  const record=async(target:'PRIMARY'|'BACKUP')=>{
    if(pending||!onSwitchStream||!window.confirm('Registrar preferência de fonte? Isto não altera PGM nem arma failover automático. Para entrar no ar, faça CUE/TAKE da fonte publicada.'))return
    setPending(true)
    try{await onSwitchStream(target)}catch(error){onMessage?.(error instanceof Error?error.message:'Escolha não registrada.')}finally{setPending(false)}
  }
  return <section aria-label="Par de fontes primária e backup" className="rounded border border-border-subtle bg-surface-card p-4 text-on-surface space-y-3">
    <h2 className="font-semibold">Fontes primária / backup</h2>
    <p className="text-xs text-armed-amber">Este cadastro não representa redundância de máquinas nem comprova qual fonte está no PGM. A ação registra uma escolha; não executa comutação de vídeo.</p>
    {!pair?<p className="text-sm">Nenhum par cadastrado. Associe a fonte backup na configuração de entradas ao vivo.</p>:<>
      <p className="text-sm">{pair.name}</p>
      <div className="flex gap-3 flex-wrap">{(['PRIMARY','BACKUP'] as const).map(role=>{const endpoint=role==='PRIMARY'?pair.primary:pair.backup,health=role==='PRIMARY'?pair.runtimeState.primaryHealth:pair.runtimeState.backupHealth;return <article key={role} className="rounded border border-border-subtle p-3">
        <h3>{role==='PRIMARY'?'Primária':'Backup'} · {endpoint.label}</h3>
        <p className="text-xs">{endpoint.enabled?'Cadastro habilitado':'Cadastro desabilitado'} · {health?'Telemetria disponível; confira o sinal no monitor':'Sem telemetria medida'}</p>
        <button type="button" disabled={pending||!onSwitchStream||!endpoint.enabled} onClick={()=>void record(role)} className="mt-2 border rounded p-2 text-xs disabled:opacity-40">Registrar escolha {role==='PRIMARY'?'primária':'backup'}</button>
      </article>})}</div>
      <p className="text-xs text-outline">Política e limites são editados na configuração da fonte. Não há chave de armação fictícia nesta tela. Use CUE/TAKE e confira a confirmação nativa para colocar uma fonte no programa.</p>
    </>}
  </section>
}
