import { useEffect, useRef, useState } from 'react'
import {QcRenderedBusPolicyFields} from './QcRenderedBusPolicyFields.js'
import { DEFAULT_QC_PROFILE, type Channel, type QcProfile,type QcReview } from '@rplayout/protocol'
import { api } from '../../api'
import {qcReviewMatches} from '../../domain/qc-review.js'
import {LiveSignalPolicyFields} from './LiveSignalPolicyFields.js'
import {QcProbePolicy} from './QcProbePolicy.js'

export function QcWorkflowPanel({ assetId, contentHash, channel, onChanged,onReview,refreshKey=0,externalBusy=false }: {
  assetId: string; contentHash: string; channel: Channel; onChanged?: () => void
  onReview?:(review:QcReview|null)=>void;refreshKey?:number;externalBusy?:boolean
}) {
  const [assessment, setAssessment] = useState<Awaited<ReturnType<typeof api.qcAssessment>> | null>(null)
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [profile, setProfile] = useState<QcProfile>(DEFAULT_QC_PROFILE)
  const [profileRevision,setProfileRevision]=useState<number|undefined>()
  const [stale,setStale]=useState(false)
  const [reopenKey,setReopenKey]=useState(0)
  const generation = useRef(0)
  const actionPending=useRef(false)
  const onReviewRef=useRef(onReview)
  onReviewRef.current=onReview
  useEffect(()=>{
    onReviewRef.current?.(!busy&&!stale&&!editing&&!notes.trim()&&assessment&&qcReviewMatches(assessment.review,assetId,contentHash,channel.id)?assessment.review:null)
  },[assessment,busy,stale,editing,notes,assetId,contentHash,channel.id])
  useEffect(() => {
    let active = true
    generation.current += 1
    setAssessment(null); setMessage(null); setNotes(''); setEditing(false); setBusy(false);setStale(false);setProfileRevision(undefined)
    onReviewRef.current?.(null)
    void api.qcAssessment(assetId, channel.id).then(result => { if (active) {
      if(!qcReviewMatches(result.review,assetId,contentHash,channel.id))throw new Error('A versão do arquivo mudou; selecione a versão atual antes de conferir.')
      setAssessment(result); setProfile(result.profile)
    } })
      .catch(error => { if (active) setMessage(error.message) })
    return () => { active = false; generation.current += 1;onReviewRef.current?.(null) }
  }, [assetId, contentHash, channel.id,reopenKey,refreshKey])
  const reopen=()=>{
    if((notes.trim()||editing) && !window.confirm('Reabrir a conferência descarta a ressalva e o perfil em edição. Continuar?'))return
    setReopenKey(value=>value+1)
  }
  const toggleProfile=()=>{
    if(editing){if(!window.confirm('Descartar os campos do perfil em edição?'))return;setEditing(false);return}
    if(!assessment||stale||externalBusy)return
    setProfile(assessment.profile);setProfileRevision(assessment.review.configurationRevision);setEditing(true)
  }
  const decide = async (status: 'ANALYSIS' | 'APPROVED_WITH_NOTES' | 'BLOCKED' | 'PENDING') => {
    const started = generation.current
    if(!assessment||stale||actionPending.current||externalBusy)return
    actionPending.current=true
    setBusy(true); setMessage(null);onReviewRef.current?.(null)
    let committed=false
    try {
      const result=await api.qcDecision(assetId, { channelId: channel.id, contentHash, status, notes },assessment.review)
      committed=true
      if(generation.current!==started)return
      onChanged?.()
      const fresh = await api.qcAssessment(assetId, channel.id)
      if (generation.current !== started) return
      if(!qcReviewMatches(fresh.review,assetId,contentHash,channel.id))throw new Error('A mídia mudou; selecione a nova versão.')
      setAssessment(fresh)
      setMessage(result.refreshError??'Decisão registrada para esta versão e este canal.')
    } catch (error) { if (generation.current === started){setStale(true);setMessage((committed?'Decisão gravada, mas a consulta posterior falhou. ':'')+(error instanceof Error ? error.message : 'QC não salvo.'))} }
    finally {actionPending.current=false; if (generation.current === started) setBusy(false) }
  }
  const saveProfile = async () => {
    const started = generation.current
    if(!assessment||stale||profileRevision===undefined||actionPending.current||externalBusy)return
    actionPending.current=true
    setBusy(true); setMessage(null);onReviewRef.current?.(null)
    let committed=false
    try {
      const result = await api.setQcProfile(channel.id, profile,profileRevision)
      committed=true
      if(generation.current!==started)return
      onChanged?.()
      const fresh = await api.qcAssessment(assetId, channel.id)
      if (generation.current !== started) return
      if(!qcReviewMatches(fresh.review,assetId,contentHash,channel.id))throw new Error('A mídia mudou; selecione a nova versão.')
      setAssessment(fresh); setEditing(false);setProfileRevision(undefined); setMessage(result.message)
    } catch (error) { if (generation.current === started){setStale(true);setMessage((committed?'Perfil gravado, mas a consulta posterior falhou. ':'')+(error instanceof Error ? error.message : 'Perfil não salvo.'))} }
    finally {actionPending.current=false; if (generation.current === started) setBusy(false) }
  }
  return <section className="p-3 rounded-lg bg-surface-panel border border-border-subtle text-xs" aria-label="Conferência técnica por canal">
    <div className="flex flex-wrap gap-2 justify-between mb-2"><strong>QC · {channel.name} · versão {contentHash.slice(0, 8)}</strong><button disabled={busy||externalBusy||!assessment||stale} className="text-primary underline disabled:opacity-40" onClick={toggleProfile}>Perfil técnico</button><button disabled={busy||externalBusy} className="text-primary underline" onClick={reopen}>Reabrir conferência</button></div>
    {assessment ? <>
      <QcProbePolicy required={Boolean(assessment.profile.requireProbe)}/>
      <p className={assessment.checks.playable ? 'text-status-ok' : 'text-on-air-crimson'}>{assessment.checks.playable ? 'Verificações técnicas configuradas atendidas.' : 'Bloqueado pelas verificações técnicas.'}</p>
      {[...assessment.checks.errors, ...assessment.checks.warnings].map((issue, index) => <p key={index} className="mt-1 text-armed-amber">{issue}</p>)}
      {assessment.decisions[0] && <p className="mt-1 text-outline">Última decisão aplicável ({assessment.decisions[0].channelId==='@all'?'todos os canais':'este canal'}): {assessment.decisions[0].status} · {assessment.decisions[0].notes ?? 'sem ressalva'}</p>}
    </> : <p>Consultando a versão…</p>}
    <label className="block mt-2">Ressalva / motivo<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={2} className="block w-full mt-1 bg-surface-base border border-outline/30 rounded p-2" /></label>
    <div className="flex flex-wrap gap-2 mt-2">
      {([['ANALYSIS', 'Em análise'], ['APPROVED_WITH_NOTES', 'Aprovar com ressalva'], ['BLOCKED', 'Bloquear PGM'], ['PENDING', 'Reabrir QC']] as const).map(([status, label]) => <button key={status} disabled={busy || externalBusy || stale || !assessment || (status === 'APPROVED_WITH_NOTES' && (!assessment.checks.playable || !notes.trim()))} onClick={() => void decide(status)} className="px-2 py-1 border border-outline/40 rounded disabled:opacity-40">{label}</button>)}
    </div>
    {editing && <div className="mt-3 p-2 rounded border border-primary/40 grid grid-cols-2 gap-2">
      <QcProbePolicy required={Boolean(profile.requireProbe)} onChange={requireProbe=>setProfile({...profile,requireProbe})}/>
      <LiveSignalPolicyFields value={profile.liveSignalPolicy} onChange={liveSignalPolicy=>setProfile({...profile,liveSignalPolicy})}/>
      <label className="col-span-2">Codecs permitidos (caps GStreamer; vazio aceita os decodificáveis)<input value={profile.codecs.join(', ')} onChange={event => setProfile({ ...profile, codecs: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} className="block w-full p-1 bg-surface-base" placeholder="video/x-h264, video/x-h265" /></label>
      {(['width', 'height', 'fps', 'minDurationSeconds', 'minLufs', 'maxLufs', 'maxTruePeakDbtp'] as const).map(field => <label key={field}>{({ width: 'Largura', height: 'Altura', fps: 'FPS', minDurationSeconds: 'Duração mínima (s)', minLufs: 'LUFS mínimo', maxLufs: 'LUFS máximo', maxTruePeakDbtp: 'True peak máximo (dBTP)' })[field]}<input type="number" step="any" value={profile[field] ?? ''} onChange={event => setProfile({ ...profile, [field]: event.target.value === '' && ['width','height','fps'].includes(field) ? null : Number(event.target.value) })} className="block w-full p-1 bg-surface-base" /></label>)}
      <label>Varredura<select value={profile.scan} onChange={event => setProfile({ ...profile, scan: event.target.value as QcProfile['scan'] })} className="block p-1 bg-surface-base"><option value="ANY">Qualquer</option><option value="PROGRESSIVE">Progressivo</option><option value="INTERLACED">Entrelaçado</option></select></label>
      <label><input type="checkbox" checked={profile.requireAudio} onChange={event => setProfile({ ...profile, requireAudio: event.target.checked })} /> Áudio obrigatório</label>
      <label><input type="checkbox" checked={profile.requireLoudness} onChange={event => setProfile({ ...profile, requireLoudness: event.target.checked })} /> Medição do arquivo inteiro e faixa de loudness obrigatórias (trecho/proxy não substituem o original)</label>
      <QcRenderedBusPolicyFields profile={profile} channels={channel.audioChannels??2} onChange={setProfile}/>
      <button disabled={busy||externalBusy||stale||profileRevision===undefined} onClick={() => void saveProfile()} className="px-2 py-1 border border-primary rounded text-primary">Salvar perfil do canal</button>
    </div>}
    {message && <p role="status" className="mt-2 text-primary">{message}</p>}
  </section>
}
