import { useState,useEffect,useRef } from 'react'
import {
  computeAutoGain,
  effectiveGainDb,
  resolvedAudioRouting,
  validateAudioRouting,
  validateAuxiliaryPairs,
  type AuxiliaryAudioPair,
  knownInputAudioChannels,
  audioRoutingKey,
  hasMatchingAudioMeasurement,
  type AudioMixAnalysisView,
  type AudioRouting,
  type AudioRoutingMode,
  type AudioLevel,
  type AudioMode,
  type Channel,
  type EditScope,
} from '@rplayout/protocol'
import type { ItemView } from '../types.js'
import { db, lufs } from '../format.js'
import { ScopePicker } from './ScopePicker.js'
import {EditScopeReviewPanel,useEditScopeReview} from './EditScopeReviewPanel.js'
import {api} from '../api.js'
import {AuxiliaryAudioPairsEditor} from './broadcast/AuxiliaryAudioPairsEditor.js'

interface Props {
  view: ItemView
  channel: Channel
  onCancel: () => void
  onApply: (audio: AudioLevel, scope: EditScope,audioTrack:number,scopeReviewToken?:string) => Promise<void>
}

const SOURCE_LABEL: Record<string, string> = {
  ITEM: 'Nível próprio deste item',
  ASSET: 'Herdado do padrão do acervo',
  FILE: 'Sem nivelamento (arquivo bruto)',
  NONE: 'Sem medição EBU R128',
}

export function AudioDialog({ view, channel, onCancel, onApply }: Props) {
  const [scope, setScope] = useState<EditScope>('ITEM')
  const scopeReview=useEditScopeReview(view.item.id,view.editorialRevision,scope)
  const [mode, setMode] = useState<AudioMode>(view.audio.mode)
  const [gain, setGain] = useState(view.gainDb)
  const [routing, setRouting] = useState<AudioRouting>(()=>resolvedAudioRouting(view.audio))
  const [matrixChannels,setMatrixChannels]=useState(view.audio.routing?.matrix?.[0]?.length ?? 2)
  const [auxiliaryPairs,setAuxiliaryPairs]=useState<readonly AuxiliaryAudioPair[]>(view.audio.auxiliaryPairs??[])

  const tracks = view.asset?.audioMetadata?.tracks??view.asset?.probe?.audioTracks??[]
  const [track,setTrack]=useState(view.item.audioTrack??0)
  const [pending,setPending]=useState(false)
  const [operationError,setOperationError]=useState<string|null>(null)
  const [analysis,setAnalysis]=useState<AudioMixAnalysisView|null>(null)
  const [analysisPending,setAnalysisPending]=useState(false)
  const [analysisError,setAnalysisError]=useState<string|null>(null)
  const routeKey=audioRoutingKey(routing),hash=view.asset?.contentHash
  const contextKey=`${view.item.id}:${hash}:${track}:${routeKey}`
  const contextRef=useRef(contextKey);contextRef.current=contextKey
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const matchingAnalysis=analysis&&analysis.contentHash===hash&&analysis.audioTrack===track&&audioRoutingKey(analysis.routing)===routeKey?analysis:null
  const startAnalysis=async()=>{
    if(!hash||analysisPending||pending||validateAudioRouting(routing,inputChannels))return
    const context=contextKey;setAnalysisPending(true);setAnalysisError(null)
    try{const result=await api.analyzeAudioMix(view.item.id,hash,track,routing,view.editorialRevision);if(mounted.current&&contextRef.current===context)setAnalysis(result.analysis)}
    catch(error){if(mounted.current&&contextRef.current===context)setAnalysisError(error instanceof Error?error.message:'Não foi possível medir o mix.')}
    finally{if(mounted.current)setAnalysisPending(false)}
  }
  useEffect(()=>{
    if(!matchingAnalysis||!['PENDING','RUNNING'].includes(matchingAnalysis.state))return
    let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined
    const poll=async()=>{
      try{const result=await api.audioMixAnalysis(view.item.id,matchingAnalysis.id);if(cancelled)return;setAnalysis(result.analysis);if(['PENDING','RUNNING'].includes(result.analysis.state))timer=setTimeout(()=>void poll(),2000)}
      catch(error){if(!cancelled)setAnalysisError(error instanceof Error?error.message:'Falha ao consultar medição. Reabra a análise para conferir o estado.')}
    }
    timer=setTimeout(()=>void poll(),1000);return()=>{cancelled=true;if(timer)clearTimeout(timer)}
  },[matchingAnalysis?.id,matchingAnalysis?.state,contextKey,view.item.id])
  const apply=async()=>{
    if(pending || !scopeReview.ready || routingError)return
    setPending(true);setOperationError(null)
    try{await onApply(next,scope,track,scopeReview.review?.token)}catch(error){setOperationError(error instanceof Error?error.message:'Não foi possível gravar o áudio.')}finally{setPending(false)}
  }

  const storedMix=hasMatchingAudioMeasurement({...view.audio,routing},hash,track)?view.audio.measured:null
  const mixMeasurement=matchingAnalysis?.state==='READY'?matchingAnalysis.measurement:storedMix
  const measured = mixMeasurement ?? (routing.mode==='DEFAULT'&&track===0 ? view.audio.analysisId?null:view.audio.measured??view.asset?.loudnessFile??null : null)
  const auto = computeAutoGain(measured, channel.targetLufs, channel.ceilingDbtp)

  const next: AudioLevel = {
    mode,
    gainDb: mode === 'MANUAL' ? gain : mode === 'AUTO' ? auto.gainDb : 0,
    measured,
    ...(mixMeasurement?{analysisId:matchingAnalysis?.state==='READY'?matchingAnalysis.id:view.audio.analysisId}:{}),
    routing,
    auxiliaryPairs,
  }
  const inputChannels=knownInputAudioChannels(view.asset,track)
  const routingError=validateAudioRouting(routing,inputChannels) ?? validateAuxiliaryPairs(auxiliaryPairs,channel.audioChannels??2,inputChannels) ?? (mode==='AUTO'&&!measured?'Meça a trilha/mix escolhido ou use ganho manual/sem ganho. A medição de outros canais não comprova este áudio.':null)
  const chooseRouting=(route:AudioRoutingMode)=>{
    if(route==='MATRIX'){
      const n=inputChannels || matrixChannels
      setMatrixChannels(n);setRouting({mode:route,matrix:[Array.from({length:n},(_,i)=>i===0?1:0),Array.from({length:n},(_,i)=>i===1?1:0)]})
    } else setRouting({mode:route})
  }
  const applied = effectiveGainDb(next, channel.targetLufs, channel.ceilingDbtp)
  const projectedLufs = measured ? measured.integratedLufs + applied : null
  const projectedPeak = measured ? measured.truePeakDbtp + applied : null
  const overCeiling = projectedPeak !== null && projectedPeak > channel.ceilingDbtp

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card w-full max-w-3xl border border-border-subtle rounded shadow-2xl flex flex-col overflow-hidden max-h-[95vh]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
            <div>
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                Nivelamento de Áudio &amp; Canais de Entrada
              </h2>
              <p className="font-label-mono text-label-mono text-outline">
                {view.item.title} · Alvo {channel.targetLufs} LUFS · Teto {channel.ceilingDbtp} dBTP · {SOURCE_LABEL[view.audioSource]}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-space-lg flex flex-col gap-space-md overflow-y-auto scrollbar-thin">
          {/* Telemetria de Loudness (Readouts) */}
          {measured ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-space-sm">
              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">MEDIDO (I):</span>
                <span className="font-headline-md text-headline-md text-on-surface font-bold tabular-nums">
                  {lufs(measured.integratedLufs)}
                </span>
                <span className="text-[10px] text-outline block">{mixMeasurement?'MIX ESCOLHIDO · ARQUIVO INTEIRO':'ARQUIVO BRUTO · TRILHA INICIAL'}</span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">TRUE PEAK:</span>
                <span className="font-headline-md text-headline-md text-on-surface font-bold tabular-nums">
                  {db(measured.truePeakDbtp)}
                </span>
                <span className="text-[10px] text-outline block">PICO MÁXIMO</span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">PROJETADO (NO AR):</span>
                <span
                  className={`font-headline-md text-headline-md font-bold tabular-nums ${
                    projectedLufs !== null && Math.abs(projectedLufs - channel.targetLufs) <= 1
                      ? 'text-status-ok-bright'
                      : 'text-armed-amber'
                  }`}
                >
                  {projectedLufs === null ? '—' : lufs(projectedLufs)}
                </span>
                <span className="text-[10px] text-outline block">ALVO: {channel.targetLufs} LUFS</span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">PICO ESTIMADO:</span>
                <span
                  className={`font-headline-md text-headline-md font-bold tabular-nums ${
                    overCeiling ? 'text-on-air-crimson' : 'text-on-surface'
                  }`}
                >
                  {projectedPeak === null ? '—' : db(projectedPeak)}
                </span>
                <span className="text-[10px] text-outline block">TETO: {channel.ceilingDbtp} dBTP</span>
              </div>
            </div>
          ) : (
            <div className="p-space-sm bg-armed-amber/10 border border-armed-amber/40 rounded flex items-center gap-space-sm text-armed-amber font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[20px]">warning</span>
              <span>A trilha/mix escolhido ainda não tem medição válida. Meça-o antes de usar ganho automático.</span>
            </div>
          )}

          {/* Seleção de Trilha do Arquivo */}
          {tracks.length > 1 && (
            <div className="flex flex-col gap-1 p-space-sm bg-surface-panel rounded border border-border-subtle">
              <label className="font-label-caps text-label-caps text-outline uppercase">Trilha de Áudio do Arquivo</label>
              <select
                value={track}
                onChange={(event) => setTrack(Number(event.target.value))}
                className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm outline-none"
              >
                {tracks.map((option) => (
                  <option key={option.index} value={option.index}>
                    Trilha {option.index + 1} ({option.channels === 1 ? 'Mono' : `${option.channels} Canais`})
                    {option.language ? ` · ${option.language.toUpperCase()}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Modo de Nivelamento */}
          <div className="flex flex-col gap-space-xs">
            <label className="font-label-caps text-label-caps text-outline uppercase">Modo de Normalização</label>
            <div className="grid grid-cols-3 gap-space-xs">
              {(['AUTO', 'MANUAL', 'OFF'] as const).map((option) => (
                <button
                  key={option}
                  disabled={option === 'AUTO' && !measured}
                  onClick={() => {
                    setMode(option)
                    if (option === 'AUTO') setGain(auto.gainDb)
                  }}
                  className={`py-2 px-space-md rounded font-label-caps text-label-caps font-bold transition-all border ${
                    mode === option
                      ? 'bg-primary-container text-on-primary-container border-border-strong shadow-sm'
                      : 'bg-surface-panel text-outline hover:text-on-surface border-border-subtle'
                  }`}
                >
                  {option === 'AUTO' ? 'EBU R128 AUTO' : option === 'MANUAL' ? 'GANHO MANUAL' : 'SEM GANHO (OFF)'}
                </button>
              ))}
            </div>
          </div>

          {/* FADER VERTICAL TÁTIL (-24dB a +12dB) E CHAVEAMENTO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md bg-surface-container-lowest rounded border border-border-subtle">
            {/* Coluna do Fader de Ganho */}
            <div className="flex flex-col gap-space-sm items-center">
              <span className="font-label-caps text-label-caps text-outline uppercase">Fader de Ganho Linear (-24dB a +12dB)</span>

              <div className="flex items-center gap-space-md w-full justify-center">
                {/* Régua de dB */}
                <div className="flex flex-col justify-between h-48 font-label-mono text-[10px] text-outline text-right py-1">
                  <span>+12 dB</span>
                  <span>+6 dB</span>
                  <span>0 dB (REF)</span>
                  <span>-6 dB</span>
                  <span>-12 dB</span>
                  <span>-24 dB</span>
                </div>

                {/* Slider / Fader Vertical */}
                <div className="relative h-48 w-12 bg-surface-panel rounded-full border border-border-subtle flex items-center justify-center p-1 overflow-hidden shadow-inner">
                  {/* Trilha central do fader */}
                  <div className="absolute top-3 bottom-3 w-1 bg-surface-container-lowest rounded-full pointer-events-none"></div>
                  <input
                    type="range"
                    min="-24"
                    max="12"
                    step="0.5"
                    disabled={mode !== 'MANUAL'}
                    value={mode === 'MANUAL' ? gain : applied}
                    onChange={(e) => setGain(Number(e.target.value))}
                    className="w-44 h-8 -rotate-90 origin-center cursor-pointer accent-primary disabled:opacity-50 relative z-10"
                    aria-label="Fader de ganho"
                  />
                </div>

                {/* Readout e Input Numérico */}
                <div className="flex flex-col gap-2">
                  <div className="bg-surface-card p-space-sm rounded border border-border-subtle text-center min-w-[100px]">
                    <span className="font-label-caps text-[10px] text-outline block">GANHO APLICADO</span>
                    <span className="font-headline-md text-headline-md font-bold text-status-ok-bright tabular-nums">
                      {applied >= 0 ? `+${applied.toFixed(1)}` : applied.toFixed(1)} dB
                    </span>
                  </div>

                  {mode === 'MANUAL' && (
                    <div className="flex flex-col gap-1">
                      <span className="font-label-caps text-[10px] text-outline">Ajuste Fino</span>
                      <input
                        type="number"
                        step="0.1"
                        min="-24"
                        max="12"
                        value={gain}
                        onChange={(e) => setGain(Number(e.target.value))}
                        className="bg-surface-card text-on-surface px-2 py-1 rounded border border-border-subtle font-label-mono text-label-mono text-center outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Coluna de Chaveamento de Canais & Roteamento SDI */}
            <div className="flex flex-col gap-space-md">
              <div className="note">Seleciona canais da trilha de entrada para o PGM estéreo, antes do ganho e limiter. Não muda o par da saída SDI. Edição fica pendente até publicação/CUE; não altera o PGM agora.</div>
              {/* Chaveamento de Canais */}
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">
                  Chaveamento de Canais
                </label>
                <div className="grid grid-cols-2 gap-1 font-label-caps text-[11px]">
                  {[
                    {id:'DEFAULT',label:'Mix padrão da entrada'},
                    { id: 'STEREO_1_2', label: 'Stereo (Ch 1-2)' },
                    { id: 'DOWNMIX_MONO', label: 'Downmix Mono (L+R)' },
                    { id: 'STEREO_3_4', label: 'Stereo Secundário (3-4)' },
                    { id: 'LEFT_ONLY', label: 'Apenas Canal L (Esq)' },
                    { id: 'RIGHT_ONLY', label: 'Apenas Canal R (Dir)' },
                    {id:'MATRIX',label:'Matriz personalizada'},
                  ].map((route) => (
                    <button
                      key={route.id}
                      disabled={pending}
                      aria-pressed={routing.mode===route.id}
                      onClick={() => chooseRouting(route.id as AudioRoutingMode)}
                      className={`py-1.5 px-2 rounded font-bold transition-colors border text-left truncate ${
                        routing.mode === route.id
                          ? 'bg-primary-container text-on-primary-container border-border-strong'
                          : 'bg-surface-panel text-outline hover:text-on-surface border-border-subtle'
                      }`}
                    >
                      {route.label}
                    </button>
                  ))}
                </div>
                {routing.mode==='PAIR_MIX'&&<p>Mix cadastrado: pares {routing.pairs?.map(pair=>`${pair*2+1}-${pair*2+2}`).join(', ')}. Mantido até escolher outro modo.</p>}
                {routing.mode==='MATRIX'&&<div className="space-y-2">
                  <label className="block text-[11px]">Canais da matriz (entrada → L/R)
                    <input type="number" min={1} max={64} value={matrixChannels} disabled={pending||inputChannels!==undefined} onChange={event=>{
                      const n=Number(event.target.value);if(!Number.isInteger(n)||n<1||n>64)return
                      setMatrixChannels(n);setRouting({mode:'MATRIX',matrix:[Array.from({length:n},(_,i)=>i===0?1:0),Array.from({length:n},(_,i)=>i===1?1:0)]})
                    }} className="w-16 bg-surface-panel border border-border-subtle ml-2"/>
                  </label>
                  <p className="text-[10px] text-outline">Coeficiente -1 a 1 por canal. 0 silencia; -1 inverte fase. A quantidade é conferida contra o áudio real no engine; sinal ausente não entra no PGM.</p>
                  <div className="overflow-x-auto"><table className="text-[10px]"><thead><tr><th>Saída</th>{routing.matrix?.[0]?.map((_,i)=><th key={i}>Ch {i+1}</th>)}</tr></thead><tbody>
                    {routing.matrix?.map((row,output)=><tr key={output}><th>{output===0?'L':'R'}</th>{row.map((coefficient,input)=><td key={input}><input aria-label={`Mix ${output===0?'L':'R'} entrada ${input+1}`} type="number" min={-1} max={1} step={0.05} value={coefficient} disabled={pending} onChange={event=>{
                      const value=Number(event.target.value);if(!Number.isFinite(value)||Math.abs(value)>1)return
                      setRouting({mode:'MATRIX',matrix:routing.matrix!.map((old,index)=>index===output?old.map((v,i)=>i===input?value:v):old)})
                    }} className="w-16 bg-surface-panel border border-border-subtle p-1"/></td>)}</tr>)}
                  </tbody></table></div>
                </div>}
                {routingError&&<div role="alert" className="note warn">{routingError}</div>}
                {view.asset&&<div className="space-y-1">
                  <button type="button" onClick={()=>void startAnalysis()} disabled={pending||analysisPending||Boolean(validateAudioRouting(routing,inputChannels))||Boolean(matchingAnalysis&&['PENDING','RUNNING'].includes(matchingAnalysis.state))} className="px-2 py-2 border border-border-subtle rounded bg-surface-panel disabled:opacity-50">{analysisPending?'Solicitando análise…':matchingAnalysis?.state==='RUNNING'?'Medindo mix…':matchingAnalysis?.state==='PENDING'?'Aguardando medição…':'Medir mix escolhido'}</button>
                  <p className="text-[10px] text-outline">Mede o arquivo inteiro, antes do ganho/limiter, na versão, trilha e canais selecionados. Não aplica áudio, não muda o PGM e não aprova QC.</p>
                  {matchingAnalysis?.state==='READY'&&<p role="status">Mix medido. Ganho automático disponível; confirme o escopo antes de aplicar.</p>}
                  {matchingAnalysis?.state==='FAILED'&&<p role="alert">{matchingAnalysis.error}</p>}
                  {analysisError&&<p role="alert">{analysisError}</p>}
                </div>}
              </div>

              {/* Roteamento SDI Integrado */}
              <AuxiliaryAudioPairsEditor channels={channel.audioChannels??2} pairs={auxiliaryPairs} inputChannels={inputChannels} onChange={setAuxiliaryPairs}/>
            </div>
          </div>

          {overCeiling && (
            <div className="p-space-sm bg-on-air-crimson/15 border border-on-air-crimson/40 rounded flex items-center gap-space-sm text-on-air-crimson font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <span>
                Atenção: Com este ganho o pico True Peak excederá o teto regulamentar ({channel.ceilingDbtp} dBTP). O limiter atuará com compressão dinâmica.
              </span>
            </div>
          )}

          <ScopePicker
            value={scope}
            onChange={setScope}
            siblingCount={view.siblingCount}
            hasAsset={view.asset !== null}
            what="nível"
          />
          <EditScopeReviewPanel state={scopeReview}/>
        </div>

        <div className="note">A trilha escolhida será aplicada somente a este item. Nível e canais seguem o escopo conferido, juntos no mesmo commit. Cancelar não altera a grade.</div>
        {operationError && <div role="alert" className="note warn">{operationError} O nível e a trilha escolhidos foram mantidos. Confira a grade antes de reabrir a edição.</div>}
        {/* Footer Actions */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-t border-border-subtle flex items-center justify-end gap-space-sm">
          <button
            type="button"
            onClick={onCancel}
            className="px-space-lg py-2 rounded bg-surface-card hover:bg-surface-container text-on-surface font-label-caps text-label-caps uppercase transition-colors border border-border-subtle"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || !scopeReview.ready || Boolean(routingError)}
            onClick={() => void apply()}
            className="px-space-lg py-2 rounded bg-primary-container text-on-primary-container hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            Aplicar Áudio e Canais
          </button>
        </div>
      </div>
    </div>
  )
}
