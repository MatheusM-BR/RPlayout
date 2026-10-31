import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_LIVE_WATCHDOG_POLICY, WATCHDOG_DETECTIONS, WATCHDOG_DETECTION_LABELS,
  type LiveWatchdogPolicy, type WatchdogDetection, type WatchdogDetectionAction, type WatchdogMode,
} from '@rplayout/protocol'
import { api } from '../../api.js'
import { deniedReason, useCan } from '../../domain/permissions.js'

const ACTION_LABELS: Record<WatchdogDetectionAction, string> = { OFF: 'Desligado', ALERT: 'Só alertar', ACT: 'Espera + contingência' }
const MODE_LABELS: Record<WatchdogMode, string> = { OFF: 'Desligado (não observa)', ALERT_ONLY: 'Só alertar (nunca mexe no PGM)', AUTOMATIC: 'Automático (arte de espera e contingência)' }
const HINTS: Record<WatchdogDetection, string> = {
  SIGNAL_LOSS: 'Nenhum quadro decodificado por mais que o tempo (queda, fim do fluxo, timeout).',
  LOW_FPS: 'Quadros novos por segundo abaixo do percentual da referência (buracos ou quadro repetido).',
  BLACK: 'Imagem preta ou quase sem informação. O tempo é a tolerância ao fade-to-black.',
  FREEZE: 'Mesmo quadro repetido (imagem parada). Preto parado conta como preto.',
  SILENCE: 'Áudio abaixo do nível por mais que o tempo.',
  AUDIO_STALL: 'Amostras de áudio sem avanço, carimbo parado ou bloco repetido com o vídeo andando.',
  AUDIO_MISSING: 'Entrada que deveria ter áudio e não entrega nenhum.',
  LOW_BITRATE: 'Taxa de dados de rede abaixo do mínimo (só SRT/RTMP informam).',
}
const toSeconds = (ms: number) => Math.round(ms / 100) / 10
const toMs = (value: string) => Math.round(Number(value.replace(',', '.')) * 1000)

/**
 * Configuração do watchdog das entradas ao vivo (Supervisor ou acima).
 * Fica no Monitor, junto da sonda PGM e da reserva de contingência: é a tela de
 * engenharia do canal, e a contingência do watchdog usa a mesma reserva.
 */
export function LiveWatchdogConfigDialog({ channelId, onClose, onSaved }: { channelId: string; onClose: () => void; onSaved: () => void }) {
  const canConfigure = useCan('OUTPUT_CONTROL')
  const [policy, setPolicy] = useState<LiveWatchdogPolicy | null>(null)
  const [revision, setRevision] = useState(0)
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [reserves, setReserves] = useState<Array<{ revisionId: string; label: string }>>([])
  const [sources, setSources] = useState<Array<{ id: string; name: string; kind: string }>>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([])
  const [saving, setSaving] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  useEffect(() => {
    let active = true
    void Promise.all([
      api.liveWatchdog(channelId),
      api.graphics(channelId).catch(() => ({ templates: [] })),
      api.contingencyLoop(channelId).catch(() => ({ options: [] as Array<{ revisionId: string; revision: number; name: string; date: string }> })),
      api.liveSources(channelId).catch(() => []),
    ]).then(([view, graphics, loop, live]) => {
      if (!active) return
      setPolicy(structuredClone(view.policy)); setRevision(view.revision)
      setTemplates(graphics.templates.map(template => ({ id: template.id, name: template.name })))
      setReserves(loop.options.map(option => ({ revisionId: option.revisionId, label: `${option.name} · ${option.date} · revisão ${option.revision}` })))
      setSources(live.map(source => ({ id: source.id, name: source.name, kind: source.kind })))
    }).catch(error => { if (active) setFailure(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [channelId])
  const update = (change: (draft: LiveWatchdogPolicy) => void) => setPolicy(previous => { if (!previous) return previous; const draft = structuredClone(previous); change(draft); return draft })
  const save = async () => {
    if (!policy) return
    setSaving(true); setFailure(null); setIssues([])
    try {
      const result = await api.saveLiveWatchdog(channelId, revision, policy)
      if (result.status !== 200 || !result.body.policy) { setFailure(result.body.error ?? 'Configuração recusada.'); setIssues(result.body.issues ?? []); return }
      setRevision(result.body.revision!); onSaved(); onClose()
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  const field = 'rounded border border-border-subtle bg-surface-card px-2 py-1 text-[12px] text-on-surface disabled:opacity-60'
  const disabled = !canConfigure || saving
  const artValue = policy ? (policy.waitArt.kind === 'GRAPHIC' ? 'GRAPHIC:' + policy.waitArt.templateId : policy.waitArt.kind) : 'SLATE'
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="watchdog-config-title" onClick={event => event.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-[1100px] flex-col rounded-xl border border-border-strong bg-surface-panel shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
          <h2 id="watchdog-config-title" className="font-headline-md text-[16px] font-bold uppercase tracking-wide text-on-surface">Watchdog das entradas ao vivo</h2>
          <button ref={closeRef} type="button" className="btn small" onClick={onClose}>FECHAR</button>
        </div>
        {!policy ? <p className="p-4 text-[12px] text-outline">{failure ?? 'Carregando configuração…'}</p> : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[12px]">
            <p className="text-outline">Vale para toda entrada ao vivo do canal (SRT, RTMP, NDI, OMT, SDI). A medição é feita no engine, sobre o sinal já decodificado. Ao detectar falha que exige ação: arte de espera por até T1; passando disso, a playlist de contingência entra em loop e a entrada fica em observação no PVW; com o sinal estável por T2, volta para a live.</p>
            {!canConfigure && <p className="text-armed-amber">{deniedReason('configurar o watchdog')}</p>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="flex flex-col gap-1">Modo
                <select aria-label="Modo do watchdog" className={field} disabled={disabled} value={policy.mode} onChange={event => update(draft => { draft.mode = event.target.value as WatchdogMode })}>
                  {(Object.keys(MODE_LABELS) as WatchdogMode[]).map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">T1 — arte de espera por até (s)
                <input aria-label="Tempo de espera T1 em segundos" type="number" min={0} max={60} step={0.5} className={field} disabled={disabled} value={toSeconds(policy.waitMs)} onChange={event => update(draft => { draft.waitMs = toMs(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">T2 — sinal estável antes do retorno (s)
                <input aria-label="Tempo de estabilidade T2 em segundos" type="number" min={1} max={300} step={0.5} className={field} disabled={disabled} value={toSeconds(policy.returnStableMs)} onChange={event => update(draft => { draft.returnStableMs = toMs(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">Retorno à live
                <select aria-label="Modo de retorno" className={field} disabled={disabled} value={policy.returnMode} onChange={event => update(draft => { draft.returnMode = event.target.value as 'AUTO' | 'MANUAL' })}>
                  <option value="AUTO">Automático depois de T2</option><option value="MANUAL">Só com confirmação do operador</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">Histerese — condição limpa por (s)
                <input aria-label="Histerese em segundos" type="number" min={0} max={10} step={0.5} className={field} disabled={disabled} value={toSeconds(policy.clearHoldMs)} onChange={event => update(draft => { draft.clearHoldMs = toMs(event.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">Referência de quadros por segundo
                <select aria-label="Referência de quadros" className={field} disabled={disabled} value={policy.fpsReference} onChange={event => update(draft => { draft.fpsReference = event.target.value as 'CHANNEL' | 'SOURCE' })}>
                  <option value="CHANNEL">Cadência do canal</option><option value="SOURCE">Cadência declarada pela entrada</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">Arte de espera
                <select aria-label="Arte de espera" className={field} disabled={disabled} value={artValue} onChange={event => update(draft => {
                  const value = event.target.value
                  draft.waitArt = value.startsWith('GRAPHIC:') ? { kind: 'GRAPHIC', templateId: value.slice(8) } : { kind: value as 'SLATE' | 'HOLD_LAST_FRAME' }
                })}>
                  <option value="SLATE">Apresentação técnica do canal</option>
                  {templates.map(template => <option key={template.id} value={'GRAPHIC:' + template.id}>Arte: {template.name}</option>)}
                  {policy.waitArt.kind === 'GRAPHIC' && !templates.some(template => policy.waitArt.kind === 'GRAPHIC' && template.id === policy.waitArt.templateId) && <option value={artValue}>Arte removida — escolha outra</option>}
                  <option value="HOLD_LAST_FRAME">Congelar último quadro (sem arte)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 md:col-span-1 xl:col-span-2">Contingência (vinheta + vídeos aprovados no QC, em loop)
                <select aria-label="Playlist de contingência do watchdog" className={field} disabled={disabled} value={policy.contingencyRevisionId ?? ''} onChange={event => update(draft => { draft.contingencyRevisionId = event.target.value || null })}>
                  <option value="">Nenhuma — manter a arte de espera</option>
                  {policy.contingencyRevisionId && !reserves.some(reserve => reserve.revisionId === policy.contingencyRevisionId) && <option value={policy.contingencyRevisionId}>Revisão substituída — selecione novamente</option>}
                  {reserves.map(reserve => <option key={reserve.revisionId} value={reserve.revisionId}>{reserve.label}</option>)}
                </select>
                <span className="text-outline">Playlist publicada com loop: o primeiro item é a vinheta, os demais os vídeos. Ao salvar, o servidor confere QC e cópia local de cada arquivo.</span>
              </label>
              <label className="flex items-center gap-2 self-end pb-1">
                <input type="checkbox" disabled={disabled} checked={policy.monitorPreview} onChange={event => update(draft => { draft.monitorPreview = event.target.checked })} />
                Medir também a entrada no PVW (só alerta)
              </label>
            </div>
            <table className="w-full border-collapse text-[12px]">
              <thead><tr className="text-left font-label-caps text-[11px] text-outline">
                <th className="py-1 pr-2">Detecção</th><th className="py-1 pr-2">Ação</th><th className="py-1 pr-2">Tempo (s)</th><th className="py-1">Parâmetros</th>
              </tr></thead>
              <tbody>
                {WATCHDOG_DETECTIONS.map(name => {
                  const detection = policy.detections[name] as LiveWatchdogPolicy['detections'][WatchdogDetection] & Record<string, number | boolean | string>
                  const numberField = (key: string, label: string, min: number, max: number, step: number) => (
                    <label className="flex items-center gap-1 whitespace-nowrap">{label}
                      <input aria-label={`${WATCHDOG_DETECTION_LABELS[name]}: ${label}`} type="number" min={min} max={max} step={step} className={`${field} w-20`} disabled={disabled || detection.action === 'OFF'}
                        value={detection[key] as number} onChange={event => update(draft => { (draft.detections[name] as unknown as Record<string, number>)[key] = Number(event.target.value.replace(',', '.')) })} />
                    </label>)
                  return (
                    <tr key={name} className="border-t border-border-subtle align-top">
                      <td className="py-1.5 pr-2"><div className="font-bold text-on-surface">{WATCHDOG_DETECTION_LABELS[name]}</div><div className="text-outline">{HINTS[name]}</div></td>
                      <td className="py-1.5 pr-2">
                        <select aria-label={`${WATCHDOG_DETECTION_LABELS[name]}: ação`} className={field} disabled={disabled} value={detection.action} onChange={event => update(draft => { draft.detections[name].action = event.target.value as WatchdogDetectionAction })}>
                          {(Object.keys(ACTION_LABELS) as WatchdogDetectionAction[]).map(action => <option key={action} value={action}>{ACTION_LABELS[action]}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input aria-label={`${WATCHDOG_DETECTION_LABELS[name]}: tempo em segundos`} type="number" min={0.1} max={120} step={0.5} className={`${field} w-20`} disabled={disabled || detection.action === 'OFF'}
                          value={toSeconds(detection.thresholdMs)} onChange={event => update(draft => { draft.detections[name].thresholdMs = toMs(event.target.value) })} />
                      </td>
                      <td className="py-1.5"><div className="flex flex-wrap items-center gap-2">
                        {name === 'LOW_FPS' && numberField('minPercent', 'mínimo %', 5, 95, 5)}
                        {name === 'BLACK' && <>{numberField('lumaMaxPercent', 'luma máx. %', 0, 50, 1)}{numberField('stdMaxPercent', 'variação máx. %', 0, 30, 0.5)}
                          <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled || detection.action === 'OFF'} checked={policy.detections.BLACK.anyFlat} onChange={event => update(draft => { draft.detections.BLACK.anyFlat = event.target.checked })} />chapado de qualquer cor</label></>}
                        {name === 'SILENCE' && numberField('dbfs', 'abaixo de dBFS', -120, -20, 1)}
                        {name === 'LOW_BITRATE' && numberField('minKbps', 'mínimo kbps', 16, 200000, 50)}
                      </div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div>
              <h3 className="mb-1 font-label-caps text-[11px] uppercase tracking-wider text-outline">Ajuste por entrada</h3>
              {!sources.length ? <p className="text-outline">Nenhuma entrada ao vivo cadastrada neste canal.</p> : (
                <table className="w-full text-[12px]"><tbody>
                  {sources.map(source => {
                    const override = policy.overrides[source.id] ?? {}
                    const set = (change: (value: NonNullable<LiveWatchdogPolicy['overrides'][string]>) => void) => update(draft => {
                      const next = { ...(draft.overrides[source.id] ?? {}) }; change(next)
                      if (next.mode == null && next.audioExpected !== false && !next.actions) delete draft.overrides[source.id]; else draft.overrides[source.id] = next
                    })
                    return (
                      <tr key={source.id} className="border-t border-border-subtle">
                        <td className="py-1 pr-2 font-bold text-on-surface">{source.name} <span className="font-normal text-outline">{source.kind}</span></td>
                        <td className="py-1 pr-2"><select aria-label={`Modo da entrada ${source.name}`} className={field} disabled={disabled} value={override.mode ?? ''} onChange={event => set(value => { value.mode = (event.target.value || null) as WatchdogMode | null; if (value.mode === null) delete value.mode })}>
                          <option value="">Igual ao canal</option>{(Object.keys(MODE_LABELS) as WatchdogMode[]).map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
                        </select></td>
                        <td className="py-1"><label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={override.audioExpected !== false} onChange={event => set(value => { if (event.target.checked) delete value.audioExpected; else value.audioExpected = false })} />entrada tem áudio</label></td>
                      </tr>
                    )
                  })}
                </tbody></table>
              )}
            </div>
            {failure && <div role="alert" className="rounded border border-armed-amber bg-armed-amber/10 px-2 py-1 text-armed-amber">{failure}{issues.length > 0 && <ul className="mt-1 list-disc pl-4">{issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul>}</div>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-4 py-2.5">
          <span className="mr-auto text-[11px] text-outline">Revisão {revision}. Salvar não altera PGM nem CUE.</span>
          <button type="button" className="rounded border border-border-subtle px-3 py-1.5 text-[12px] disabled:opacity-50" disabled={disabled || !policy} onClick={() => setPolicy({ ...structuredClone(DEFAULT_LIVE_WATCHDOG_POLICY), overrides: policy?.overrides ?? {} })}>RESTAURAR PADRÕES</button>
          <button type="button" className="rounded border border-border-subtle px-3 py-1.5 text-[12px]" onClick={onClose}>CANCELAR</button>
          <button type="button" className="rounded border border-status-ok bg-status-ok/20 px-3 py-1.5 text-[12px] font-bold text-status-ok-bright disabled:opacity-50" disabled={disabled || !policy} onClick={() => void save()}>{saving ? 'VERIFICANDO…' : 'SALVAR'}</button>
        </div>
      </div>
    </div>
  )
}
