import {useEffect,useRef,useState} from 'react'
import {api,type HaBindingReview,type HaPreparationRequest,type HaPreparationReport} from '../../api.js'
import {commandRequestId} from '../../domain/request-id.js'
type OutputChoice={disposition:'LOCAL'|'DISABLED';localTarget:string;reason:string}
const preparationStorage='rplayout-ha-preparation-v1'
const issueLabels:Record<string,string>={
  LOCAL_DECODE_NOT_PROVEN:'Decodificação local não comprovada',TRIM_OUTSIDE_LOCAL_MEDIA:'Corte fora da duração local',INVALID_AUDIO_TRACK:'Trilha de áudio inválida',LOCAL_AUDIO_TRACK_MISSING:'Trilha selecionada ausente',LOCAL_AUDIO_ROUTING_INVALID:'Roteamento de áudio incompatível',LOCAL_AUXILIARY_PAIRS_INVALID:'Pares auxiliares incompatíveis',SELECTED_AUDIO_MEASUREMENT_MISSING:'Falta medição deste corte/mix',LOCAL_SELECTED_MIX_RENDER_PENDING:'Conferir render do mix selecionado',LOCAL_MOUNT_INVALID:'Montagem local inválida',FALLBACK_MEDIA_VERSION_MISSING:'Arquivo de contingência ausente',MEDIA_VERSION_MISSING:'Versão de mídia ausente',LIVE_SIGNAL_LOCAL_PENDING:'Sinal local ainda não comprovado',LOCAL_GRAPHIC_TEMPLATE_MISSING:'Template de grafismo ausente',LOCAL_GRAPHIC_RENDER_PENDING:'Conferir render e fontes do grafismo',GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED:'Recurso externo do grafismo precisa de vínculo local',EXTERNAL_AUTOMATION_LOCAL_BINDING_REQUIRED:'Automação externa precisa de vínculo local',
}
function rememberedPreparation():HaPreparationRequest|null{
  try{const value=JSON.parse(sessionStorage.getItem(preparationStorage)??'null');return value&&typeof value.requestId==='string'&&typeof value.channelId==='string'&&typeof value.bindingPlanId==='string'&&Number.isSafeInteger(value.sequence)&&value.sequence>0?value:null}catch{return null}
}
export function HaBindingsPanel(){
  const [channels,setChannels]=useState<Array<{id:string;name:string}>>([]),[channelId,setChannelId]=useState('')
  const [review,setReview]=useState<HaBindingReview|null>(null),[inputs,setInputs]=useState<Record<string,string>>({}),[outputs,setOutputs]=useState<Record<string,OutputChoice>>({})
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null)
  const generation=useRef(0),mounted=useRef(true)
  const [preparation,setPreparation]=useState<HaPreparationReport|null>(null),[preparationRequest,setPreparationRequest]=useState<HaPreparationRequest|null>(rememberedPreparation)
  useEffect(()=>{try{if(preparationRequest)sessionStorage.setItem(preparationStorage,JSON.stringify(preparationRequest));else sessionStorage.removeItem(preparationStorage)}catch{}},[preparationRequest])
  useEffect(()=>{mounted.current=true;void api.haBindingChannels().then(value=>{if(mounted.current)setChannels(value.channels)}).catch(failure=>{if(mounted.current)setError(failure instanceof Error?failure.message:'Canais do espelho indisponíveis.')});return()=>{mounted.current=false;generation.current++}},[])
  const load=async(id:string)=>{
    const request=++generation.current;setBusy(true);setError(null);setMessage(null);setReview(null)
    try{
      const value=await api.haBindingReview(id)
      if(!mounted.current||request!==generation.current)return
      setReview(value);setInputs(Object.fromEntries(value.saved&&!value.saved.stale?value.saved.inputs.map(row=>[row.sourceKey,row.localKey]):[]))
      setOutputs(Object.fromEntries(value.outputs.map(row=>[row.outputId,{disposition:'DISABLED',localTarget:'',reason:''}])))
    }catch(failure){if(mounted.current&&request===generation.current)setError(failure instanceof Error?failure.message:'Conferência indisponível.')}
    finally{if(mounted.current&&request===generation.current)setBusy(false)}
  }
  const save=async()=>{
    if(!review||busy)return
    const request=++generation.current;setBusy(true);setError(null);setMessage(null)
    try{
      const value=await api.saveHaBindings({requestId:commandRequestId(),channelId:review.channelId,sequence:review.sequence,basePlanId:review.basePlanId,reviewToken:review.reviewToken,
        inputs:review.inputs.map(row=>({sourceKey:row.sourceKey,localKey:inputs[row.sourceKey]??''})),
        outputs:review.outputs.map(row=>{const chosen=outputs[row.outputId]!;return {outputId:row.outputId,disposition:chosen.disposition,...(chosen.disposition==='LOCAL'?{localTarget:chosen.localTarget}:{reason:chosen.reason})}}),
      })
      if(mounted.current&&request===generation.current){setReview(value);setMessage('Plano local registrado. Nenhuma entrada, placa ou saída foi aberta; isso não autoriza promoção.')}
    }catch(failure){if(mounted.current&&request===generation.current)setError(failure instanceof Error?failure.message:'Resultado não confirmado. Atualize a conferência antes de enviar outro pedido.')}
    finally{if(mounted.current&&request===generation.current)setBusy(false)}
  }
  const changeOutput=(id:string,patch:Partial<OutputChoice>)=>setOutputs(old=>({...old,[id]:{...old[id]!,...patch}}))
  const prepare=async()=>{
    if(busy||!review?.saved||review.saved.stale||preparationRequest)return
    const body:HaPreparationRequest={requestId:commandRequestId(),channelId:review.channelId,sequence:review.sequence,bindingPlanId:review.saved.id}
    try{sessionStorage.setItem(preparationStorage,JSON.stringify(body))}catch{setError('Navegador não consegue guardar o pedido para consulta segura. Habilite o armazenamento antes de preparar.');return}
    setPreparationRequest(body);setPreparation(null);setBusy(true);setError(null)
    try{const value=await api.prepareHaBindings(body);if(mounted.current)setPreparation(value)}
    catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:'Resultado não confirmado. Consulte o pedido; não envie outro automaticamente.')}
    finally{if(mounted.current)setBusy(false)}
  }
  const queryPreparation=async()=>{
    if(busy||!preparationRequest)return
    setBusy(true);setError(null)
    try{
      const history=await api.haPreparationReports(),body=preparationRequest
      const value=history.reports.find(row=>row.requestId===body.requestId&&row.channelId===body.channelId&&row.sequence===body.sequence&&row.bindingPlanId===body.bindingPlanId)
      if(mounted.current){if(value)setPreparation(value);else setError('Pedido não consta no histórico recente. Confira o histórico antes de autorizar nova preparação.')}
    }catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:'Consulta indisponível.')}
    finally{if(mounted.current)setBusy(false)}
  }
  return <section aria-label="Vínculos locais do nó reserva" className="border border-border-subtle rounded p-3 space-y-3 text-sm">
    <h3 className="font-semibold">Preparação local do reserva</h3>
    <p className="text-xs text-outline">Escolha as entradas e saídas desta máquina. Endereços e números de placa do primário não são reutilizados automaticamente. Descoberta não comprova sinal.</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Canal espelhado para preparar" value={channelId} disabled={busy} onChange={event=>{const id=event.target.value;setChannelId(id);setReview(null);if(id)void load(id)}} className="bg-surface-base border border-border-subtle rounded p-2">
        <option value="">Selecione o canal espelhado</option>{channels.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      <button disabled={busy||!channelId} onClick={()=>void load(channelId)} className="border border-border-subtle rounded p-2">Atualizar conferência</button>
    </div>
    {busy&&<p>Conferindo espelho e descoberta local…</p>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {review&&<>
      <p className="text-xs">Sequência {review.sequence} · {review.saved?`plano anterior ${review.saved.stale?'desatualizado':'registrado, ainda não homologado'}`:'sem plano local registrado'}</p>
      {review.inputs.map(row=><label className="block" key={row.sourceKey}>{row.items.map(item=>item.title).filter((name,index,all)=>all.indexOf(name)===index).join(' / ')} · {row.family}
        <select aria-label={`Entrada local para ${row.items[0]?.title??row.family}`} disabled={busy} value={inputs[row.sourceKey]??''} onChange={event=>setInputs(old=>({...old,[row.sourceKey]:event.target.value}))} className="block w-full bg-surface-base border border-border-subtle rounded p-2">
          <option value="">Escolha uma entrada desta máquina</option>{review.localInputs.filter(local=>local.family===row.family).map(local=><option key={local.key} value={local.key}>{local.label}</option>)}
        </select>
      </label>)}
      {review.outputs.map(row=>{const choice=outputs[row.outputId]!;return <fieldset key={row.outputId} className="border border-border-subtle rounded p-2 space-y-2">
        <legend>{row.name} · {row.kind}</legend>
        <select aria-label={`Uso local de ${row.name}`} disabled={busy} value={choice.disposition} onChange={event=>changeOutput(row.outputId,{disposition:event.target.value as OutputChoice['disposition'],localTarget:'',reason:''})} className="bg-surface-base border border-border-subtle rounded p-2"><option value="DISABLED">Desativar explicitamente</option><option value="LOCAL">Configurar destino local</option></select>
        {choice.disposition==='DISABLED'?<input aria-label={`Motivo para desativar ${row.name}`} disabled={busy} value={choice.reason} onChange={event=>changeOutput(row.outputId,{reason:event.target.value})} placeholder="Motivo obrigatório" className="block w-full bg-surface-base border border-border-subtle rounded p-2"/>:row.kind==='SDI'?<select aria-label={`Porta de saída local de ${row.name}`} disabled={busy} value={choice.localTarget} onChange={event=>changeOutput(row.outputId,{localTarget:event.target.value})} className="block w-full bg-surface-base border border-border-subtle rounded p-2"><option value="">Escolha uma saída SDI descoberta</option>{review.localSdiOutputs.map(local=><option key={local.key} value={local.key}>{local.label}</option>)}</select>:<input aria-label={`Destino local de ${row.name}`} disabled={busy} value={choice.localTarget} autoComplete="off" onChange={event=>changeOutput(row.outputId,{localTarget:event.target.value})} placeholder="Informe o destino local completo" className="block w-full bg-surface-base border border-border-subtle rounded p-2"/>}
      </fieldset>})}
      <p className="text-xs text-outline">Cada saída exige escolha e motivo explícitos. Mídia/QC, tracks, mixes, trims, sinal físico e autorização de execução são etapas separadas.</p>
      <button disabled={busy} onClick={()=>void save()} className="border border-border-subtle rounded p-2">Registrar plano local — não entra no ar</button>
      <button disabled={busy||!review.saved||review.saved.stale||Boolean(preparationRequest)} onClick={()=>void prepare()} className="border border-border-subtle rounded p-2">Preparar edição local — permanece parada</button>
    </>}
    {preparationRequest&&<section className="border border-border-subtle rounded p-2 space-y-2" aria-label="Resultado da preparação local">
      <p className="text-xs break-all">Pedido {preparationRequest.requestId} · canal {preparationRequest.channelId}</p>
      <button disabled={busy} onClick={()=>void queryPreparation()} className="border border-border-subtle rounded p-2">Consultar resultado — sem repetir preparação</button>
      {preparation&&<>
        <p role="status">{preparation.phase} · {preparation.reason}</p>
        <p>{preparation.restoredRevisions} edições · {preparation.verifiedMedia} mídias · {preparation.qcBlocked} bloqueios de QC{preparation.localProbeRequired?' · análise local ainda necessária':''}</p>
        {preparation.localMounts&&<p>{preparation.localMounts.blocked} montagens bloqueadas · {preparation.localMounts.livePending} lives sem sinal comprovado · {preparation.localMounts.selectedMixPending} mixes para conferir · {preparation.localMounts.externalAutomationBlocked} automações externas bloqueadas</p>}
        {Boolean(preparation.localMounts?.graphicPending)&&<p>{preparation.localMounts?.graphicPending} grafismos para conferir no render local</p>}
        {Boolean(preparation.localMounts?.issues?.length)&&<details><summary>Ver pendências por item</summary><ul className="space-y-2 p-2">{preparation.localMounts?.issues?.map((issue,index)=><li key={issue.itemId+':'+index}><span className="break-all" title={`Item ${issue.itemId} · edição ${issue.revisionId??'não informada'}`}>{issue.title??issue.itemId}</span>: {[...issue.errors,...issue.warnings].map(code=>issueLabels[code]??code).join('; ')}</li>)}</ul>{preparation.localMounts?.issuesTruncated&&<p>Lista limitada aos primeiros 200 registros; os totais acima abrangem todos.</p>}</details>}
        {preparation.phase!=='CHECKING'&&<button disabled={busy} onClick={()=>{setPreparationRequest(null);setPreparation(null)}} className="border border-border-subtle rounded p-2">Encerrar consulta deste pedido</button>}
      </>}
    </section>}
  </section>
}
