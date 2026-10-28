import type {IncidentContext} from '@rplayout/protocol'
export function IncidentContextDetails({context}:{context:IncidentContext|null|undefined}){
  if(!context)return <p className="text-[11px] text-outline">Contexto não registrado nesta versão do incidente.</p>
  return <details className="text-[11px] mt-1">
    <summary className="cursor-pointer text-primary">CONTEXTO NA DETECÇÃO</summary>
    <div className="space-y-1 mt-1 text-outline">
      <p>Registrado em {new Date(context.capturedAt).toLocaleString('pt-BR')}. Contexto histórico; não confirma sinal atual.</p>
      <p title={context.itemId??undefined}>PGM: {context.itemName??'Nome não disponível'} · item {context.itemId??'N/D'} · posição {context.elapsedFrames??'N/D'} quadros</p>
      <p>Edição: {context.revisionId??'N/D'} · execução: {context.executionId??'N/D'}</p>
      <p>Engine: {context.engine.ready?'pronto':'não pronto'} · {context.engine.processPresent?'processo presente':'processo não reportado'}; não homologa saída física.</p>
      {context.sources.map(source=><div key={source.identity} title={source.identity}>Fonte: {source.name??'Nome não disponível'} · {source.state??'N/D'} · PGM {source.pgm??'N/D'} / PVW {source.pvw??'N/D'}{source.pgmSelection&&<p>Seleção PGM: {source.pgmSelection.name??'N/D'} · {source.pgmSelection.basis==='NATIVE_DECODER'?'cadastro reportado pelo decoder':'vínculo editorial, não sinal confirmado'}</p>}</div>)}
      {context.outputs.map(output=><div key={output.identity} title={output.identity}>Saída: {output.name??'Nome não disponível'} · {output.state??'N/D'}{output.hasError?' · erro registrado':''} · {output.identityType==='PROFILE'?'perfil reportado':'identidade por endereço protegido; perfil não confirmado'}</div>)}
      {(context.sourcesTruncated||context.outputsTruncated)&&<p>Listas limitadas na coleta; consulte o histórico operacional.</p>}
    </div>
  </details>
}
