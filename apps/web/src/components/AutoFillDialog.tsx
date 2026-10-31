import { useEffect, useState, useMemo, useRef } from 'react'
import type {Rate,ScheduleRuleReview} from '@rplayout/protocol'
import { api } from '../api.js'
import { dur } from '../format.js'
import type {FillImpact,FillPlan,FillProposal,Snapshot} from '../types.js'
import {ScheduleRulesEditor} from './ScheduleRulesEditor.js'

interface Props {
  rundownId: string
  revision:number|undefined
  channelId: string
  /** Categorias que existem no acervo, para a faixa escolher entre elas. */
  categories: string[]
  rate: Rate
  initialHours?: number
  initialMinutes?: number
  initialStart?: string
  initialEnd?: string
  autoPreview?: boolean
  onCancel: () => void
  onApplied: (snapshot: Snapshot, message: string) => void
  onMessage: (text: string) => void
}

const parseHhmm = (text: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes <= 1440 ? minutes : null
}

export function AutoFillDialog(props:Props) {
  const [{
  rundownId,
  revision,
  channelId,
  categories,
  rate,
  initialHours,
  initialMinutes,
  initialStart,
  initialEnd,
  autoPreview = false,
  onCancel,
  onApplied,
  onMessage,
  }]=useState(()=>props)
  // Modo de preenchimento: 'duration' (horas + minutos), 'range' (De... Até...), ou 'rules' (Pauta diária)
  const [mode, setMode] = useState<'duration' | 'range' | 'rules'>('duration')

  // Inputs de Duração (Horas e Minutos)
  const [hours, setHours] = useState(() => (initialHours != null ? initialHours : 0))
  const [minutesInput, setMinutesInput] = useState(() => (initialMinutes != null ? initialMinutes : initialHours != null ? 0 : 30))

  // Inputs de Intervalo Horário (De... Até...)
  const [timeFrom, setTimeFrom] = useState(() => {
    if (initialStart) return initialStart
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [timeTo, setTimeTo] = useState(() => {
    if (initialEnd) return initialEnd
    const future = new Date(Date.now() + 60 * 60 * 1000)
    return `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`
  })

  // "Não repetir por padrão venha zerado" -> padrão 0!
  const [avoidHours, setAvoidHours] = useState(0)

  // Ponto de Inserção na Grade para o Modo Duração: 'gap' (no GAP), 'time' (no horário), 'end' (fim da grade)
  const [insertTarget, setInsertTarget] = useState<'gap' | 'time' | 'end'>(() => (initialStart ? 'gap' : 'end'))
  const [customInsertTime, setCustomInsertTime] = useState(() => initialStart ?? '12:00')

  // Estado do plano
  const [plan, setPlan] = useState<FillPlan | null>(null)
  const [proposal,setProposal]=useState<(FillProposal&{criteriaKey:string})|null>(null)
  const [bands,setBands]=useState<{rule:string;items:number;leftover:number}[]>([])
  const [impact,setImpact]=useState<FillImpact[]>([])
  const busyRef=useRef(false)
  const [busy, setBusy] = useState(false)
  const [operationError,setOperationError]=useState<string|null>(null)

  // The child owns its original draft proof; this snapshot is only for the
  // AutoFill criteria. A list refresh cannot renew the child form.
  const [rulesReview,setRulesReview]=useState<ScheduleRuleReview|null>(null)
  const [rulesReady,setRulesReady]=useState(false)
  const rules=rulesReview?.rules??null

  // Cálculo de minutos efetivos a preencher dependendo do modo ativo
  const calculatedMinutes = useMemo(() => {
    if (mode === 'duration') {
      return Math.max(1, (Math.max(0, hours) * 60) + Math.max(0, minutesInput))
    }
    if (mode === 'range') {
      const from = parseHhmm(timeFrom)
      const to = parseHhmm(timeTo)
      if (from !== null && to !== null) {
        if (to > from) return to - from
        // Se cruzar meia-noite (ex: 23:00 até 01:00)
        return (1440 - from) + to
      }
      return 60
    }
    return 60
  }, [mode, hours, minutesInput, timeFrom, timeTo])

  // Formatação legível do tempo calculado
  const durationSummary = useMemo(() => {
    const h = Math.floor(calculatedMinutes / 60)
    const m = calculatedMinutes % 60
    if (h === 0) return `${m} min`
    if (m === 0) return `${h}h`
    return `${h}h ${String(m).padStart(2, '0')}m (${calculatedMinutes} min)`
  }, [calculatedMinutes])


  // Auto-propor se aberto via GAP
  const autoPreviewRanRef = useRef(false)
  useEffect(() => {
    if (autoPreview && !autoPreviewRanRef.current && calculatedMinutes > 0) {
      autoPreviewRanRef.current = true
      run(true)
    }
  }, [autoPreview, calculatedMinutes])

  // Compare every editable criterion, not just the visible duration. A changed
  // draft keeps the old review visible, but cannot apply it as a new request.
  const criteriaKey=JSON.stringify({mode,hours,minutesInput,timeFrom,timeTo,avoidHours,insertTarget,customInsertTime,initialStart,rules:mode==='rules'?rulesReview:null,rulesReady:mode==='rules'?rulesReady:null})
  const proposalCurrent=proposal?.criteriaKey===criteriaKey && proposal.kind===(mode==='rules'?'DAY':'WINDOW')

  const run = (preview: boolean): void => {
    if(busyRef.current)return
    if(mode==='rules'&&!rulesReady){setOperationError('Reabra a conferência das faixas antes de propor ou aplicar o dia.');return}
    if(!preview){
      if(!proposal || !proposalCurrent)return
      busyRef.current=true;setBusy(true);setOperationError(null)
      const request=proposal.kind==='DAY'
        ? ()=>api.autoFillDay(rundownId,proposal.editorialRevision,{proposalId:proposal.id})
        : ()=>api.autoFill(rundownId,{proposalId:proposal.id},proposal.editorialRevision)
      Promise.resolve().then(request).then(result=>{
        if(!result.view)throw new Error('A montagem não retornou a grade confirmada. Atualize antes de tentar novamente.')
        onApplied(result as Snapshot,`${result.plan.items.length} itens da proposta conferida foram inseridos. Revise e publique para operação.`)
      }).catch((failure:Error)=>{setOperationError(failure.message);onMessage(failure.message)})
        .finally(()=>{busyRef.current=false;setBusy(false)})
      return
    }
    const janela=calculatedMinutes
    let insertAtMinute:number|undefined
    if(mode==='range'){
      const from=parseHhmm(timeFrom),to=parseHhmm(timeTo)
      if(from===null || to===null || from===to){setOperationError('Informe um intervalo horário válido.');return}
      insertAtMinute=from
    }else if(insertTarget==='gap'&&initialStart)insertAtMinute=parseHhmm(initialStart)??undefined
    else if(insertTarget==='time'){
      const minute=parseHhmm(customInsertTime)
      if(minute===null){setOperationError('Informe um horário de inserção válido.');return}
      insertAtMinute=minute
    }
    busyRef.current=true;setBusy(true);setOperationError(null)
    const capturedKey=criteriaKey
    const request=mode==='rules'
      ? ()=>api.autoFillDay(rundownId,revision,{preview:true})
      : ()=>api.autoFill(rundownId,{minutes:janela,avoidHours,preview:true,insertAtMinute},revision)
    Promise.resolve().then(request).then(result=>{
      if(result.proposal.rundownId!==rundownId || result.proposal.channelId!==channelId)
        throw new Error('A proposta não corresponde à grade aberta. Feche e confira a seleção.')
      setPlan(result.plan);setBands(result.bands??[]);setImpact(result.impact??[])
      setProposal({...result.proposal,criteriaKey:capturedKey})
      onMessage(`Proposta conferida: ${result.plan.items.length} itens. A aplicação não recalculará a seleção.`)
    }).catch((failure:Error)=>{setOperationError(failure.message);onMessage(failure.message)})
      .finally(()=>{busyRef.current=false;setBusy(false)})
  }

  const fillDay = (): void => run(false)


  return (
    <div
      role="dialog" aria-modal="true" aria-label="Preencher grade automaticamente" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="bg-[#0c101a] border border-border-subtle rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden text-on-surface select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* CABEÇALHO */}
        <header className="px-5 py-3.5 bg-surface-container-high border-b border-border-subtle flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-armed-amber/20 border border-armed-amber/50 flex items-center justify-center text-armed-amber">
              <span className="material-symbols-outlined text-[20px]">auto_fix_high</span>
            </div>
            <div className="flex flex-col">
              <h2 className="font-headline-sm text-sm font-bold text-on-surface tracking-wide uppercase flex items-center gap-2">
                Assistente de AutoFill
                <span className="px-1.5 py-0.2 rounded bg-primary/20 text-primary text-[12px] font-label-mono">
                  ACERVO
                </span>
              </h2>
              <span className="font-label-mono text-[12px] text-outline">
                Propõe arquivos aprovados do acervo para preencher lacunas e faixas; nada entra sem você aplicar
              </span>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 rounded hover:bg-surface-panel flex items-center justify-center text-outline hover:text-on-surface transition-colors cursor-pointer text-sm font-bold"
            title="Fechar (Esc)"
          >
            ✕
          </button>
        </header>

        {/* NAVEGAÇÃO DE MODOS / ABAS */}
        <div className="px-5 pt-3 pb-1 bg-surface-base border-b border-border-subtle/70 flex items-center gap-2 shrink-0">
          <button
            onClick={() => setMode('duration')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[11px] font-label-caps transition-all cursor-pointer border-b-2 ${
              mode === 'duration'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">timer</span>
            Por Duração (Horas e Minutos)
          </button>

          <button
            onClick={() => setMode('range')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[11px] font-label-caps transition-all cursor-pointer border-b-2 ${
              mode === 'range'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">schedule</span>
            Por Intervalo (De ... Até ...)
          </button>

          <button
            onClick={() => setMode('rules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[11px] font-label-caps transition-all cursor-pointer border-b-2 ${
              mode === 'rules'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">calendar_view_day</span>
            Pauta Diária &amp; Faixas
          </button>
        </div>

        {/* CORPO SCROLLÁVEL */}
        <fieldset disabled={busy} className="p-5 flex-1 min-h-0 overflow-y-auto broadcast-scroll flex flex-col gap-4">
          {mode === 'duration' && (
            <div className="bg-surface-panel p-4 rounded-lg border border-border-subtle flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                  TEMPO A PREENCHER
                </span>
                <span className="px-2 py-0.5 rounded bg-primary/20 text-primary font-label-mono font-bold text-xs">
                  {durationSummary}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-label-mono text-outline flex items-center justify-between">
                    <span>Horas</span>
                    <span className="text-[11px] text-primary font-bold">h</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    value={hours}
                    onChange={(e) => setHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-base font-label-mono px-3 py-2 rounded focus:outline-none"
                    placeholder="0"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-label-mono text-outline flex items-center justify-between">
                    <span>Minutos</span>
                    <span className="text-[11px] text-primary font-bold">m</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={minutesInput}
                    onChange={(e) => setMinutesInput(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-base font-label-mono px-3 py-2 rounded focus:outline-none"
                    placeholder="30"
                  />
                </div>
              </div>

              {/* Atalhos Rápidos de Duração */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-label-caps text-outline mr-1">ATALHOS:</span>
                {[
                  { label: '15m', h: 0, m: 15 },
                  { label: '30m', h: 0, m: 30 },
                  { label: '45m', h: 0, m: 45 },
                  { label: '1h 00m', h: 1, m: 0 },
                  { label: '1h 30m', h: 1, m: 30 },
                  { label: '2h 00m', h: 2, m: 0 },
                  { label: '3h 00m', h: 3, m: 0 },
                  { label: '4h 00m', h: 4, m: 0 },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      setHours(chip.h)
                      setMinutesInput(chip.m)
                    }}
                    className={`px-2 py-0.5 rounded text-[12px] font-label-mono transition-colors cursor-pointer border ${
                      hours === chip.h && minutesInput === chip.m
                        ? 'bg-primary text-surface-base border-primary font-bold'
                        : 'bg-surface-container border-border-subtle text-outline hover:text-on-surface hover:border-primary/50'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Ponto de Inserção na Grade (Modo Duração) */}
              <div className="pt-3 mt-1 border-t border-border-subtle/60 flex flex-col gap-2">
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-primary">add_location_alt</span>
                  PONTO DE INSERÇÃO NA GRADE
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {initialStart && (
                    <button
                      type="button"
                      onClick={() => setInsertTarget('gap')}
                      className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer transition-colors ${
                        insertTarget === 'gap'
                          ? 'bg-armed-amber/15 border-armed-amber text-armed-amber font-semibold shadow-sm'
                          : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                      }`}
                    >
                      <span className="font-label-caps text-[11px] font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-armed-amber"></span>
                        No GAP Selecionado
                      </span>
                      <span className="text-[12px] font-label-mono opacity-80">
                        A partir das {initialStart}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setInsertTarget('time')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer transition-colors ${
                      insertTarget === 'time'
                        ? 'bg-primary/20 border-primary text-primary font-semibold shadow-sm'
                        : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="font-label-caps text-[11px] font-bold flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">schedule</span>
                      No Horário Específico
                    </span>
                    <span className="text-[12px] font-label-mono opacity-80">
                      Definir hora de início (hh:mm)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInsertTarget('end')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer transition-colors ${
                      insertTarget === 'end'
                        ? 'bg-primary/20 border-primary text-primary font-semibold shadow-sm'
                        : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="font-label-caps text-[11px] font-bold flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">vertical_align_bottom</span>
                      No Final da Grade
                    </span>
                    <span className="text-[12px] font-label-mono opacity-80">
                      Após o último item programado
                    </span>
                  </button>
                </div>

                {insertTarget === 'time' && (
                  <div className="flex items-center gap-2 mt-1 bg-surface-base p-2 rounded border border-border-subtle">
                    <label className="text-[12px] font-label-mono text-outline">
                      Iniciar inserção às:
                    </label>
                    <input
                      type="text"
                      value={customInsertTime}
                      onChange={(e) => setCustomInsertTime(e.target.value)}
                      placeholder="ex: 14:30"
                      className="bg-surface-panel border border-border-subtle focus:border-primary text-on-surface text-sm font-label-mono px-2.5 py-1 rounded w-28 focus:outline-none"
                    />
                    <span className="text-[12px] text-outline font-label-mono">
                      (Os itens serão acomodados nesta hora e os subsequentes reorganizados)
                    </span>
                  </div>
                )}

                <div className="p-2 rounded bg-surface-base/80 border border-border-subtle/60 text-[11px] text-outline leading-relaxed flex items-start gap-1.5 mt-1">
                  <span className="material-symbols-outlined text-[15px] text-primary shrink-0">info</span>
                  <span>
                    <strong>Como funciona o Modo Duração:</strong> Você define o tempo total a ser preenchido ({durationSummary}). O sistema seleciona os vídeos do MAM mais adequados e os insere <strong>{insertTarget === 'gap' ? `exatamente no GAP detectado às ${initialStart}` : insertTarget === 'time' ? `no ponto horário ${customInsertTime}` : 'no fim da programação atual'}</strong>, recalculando os horários da grade sem criar novos buracos.
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === 'range' && (
            <div className="bg-surface-panel p-4 rounded-lg border border-border-subtle flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                  FAIXA HORÁRIA DE EXIBIÇÃO
                </span>
                <span className="px-2 py-0.5 rounded bg-primary/20 text-primary font-label-mono font-bold text-xs">
                  {durationSummary}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-label-mono text-outline">
                    De (Horário de Início):
                  </label>
                  <input
                    type="text"
                    placeholder="ex: 14:00"
                    value={timeFrom}
                    onChange={(e) => setTimeFrom(e.target.value)}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-sm font-label-mono px-3 py-2 rounded focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-label-mono text-outline">
                    Até (Horário de Término):
                  </label>
                  <input
                    type="text"
                    placeholder="ex: 16:30"
                    value={timeTo}
                    onChange={(e) => setTimeTo(e.target.value)}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-sm font-label-mono px-3 py-2 rounded focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-2 rounded bg-surface-base/80 border border-border-subtle/60 text-[11px] text-outline leading-relaxed flex items-start gap-1.5">
                <span className="material-symbols-outlined text-[15px] text-primary shrink-0">info</span>
                <span>
                  <strong>Como funciona o Modo Intervalo:</strong> Você especifica a janela exata do relógio ({timeFrom} até {timeTo}). O sistema calcula a duração ({durationSummary}) e insere os vídeos a partir das <strong>{timeFrom}</strong>, preenchendo a lacuna entre programas.
                </span>
              </div>
            </div>
          )}

          {/* PARÂMETRO NÃO REPETIR: ZERADO POR PADRÃO */}
          {mode !== 'rules' && (
            <div className="bg-surface-panel p-4 rounded-lg border border-border-subtle flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-outline text-[16px]">history</span>
                  <label className="text-[11px] font-label-caps text-outline font-bold uppercase">
                    Não Repetir nas Últimas (Horas)
                  </label>
                </div>
                <span className="font-label-mono text-xs text-status-ok-bright font-bold">
                  {avoidHours === 0 ? '0h (Tudo Liberado)' : `${avoidHours} horas`}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="240"
                  value={avoidHours}
                  onChange={(e) => setAvoidHours(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-28 bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-sm font-label-mono px-3 py-1.5 rounded focus:outline-none"
                  placeholder="0"
                />

                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: '0h (Padrão)', val: 0 },
                    { label: '2h', val: 2 },
                    { label: '6h', val: 6 },
                    { label: '12h', val: 12 },
                    { label: '24h', val: 24 },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setAvoidHours(chip.val)}
                      className={`px-2 py-0.5 rounded text-[12px] font-label-mono transition-colors cursor-pointer border ${
                        avoidHours === chip.val
                          ? 'bg-status-ok text-surface-base border-status-ok font-bold'
                          : 'bg-surface-container border-border-subtle text-outline hover:text-on-surface'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-outline font-body-sm leading-relaxed">
                Padrão zero (0h): todos os arquivos aprovados no acervo podem ser propostos. Se você aumentar, o sistema protege contra reprises muito próximas.
              </p>
            </div>
          )}

          {/* PLANO DE PREENCHIMENTO PROPOSTO (PREVIEW) */}
          {plan && (
            <div className="bg-surface-panel rounded-lg border border-border-subtle overflow-hidden flex flex-col">
              <div
                className={`p-3 border-b flex items-center justify-between ${
                  plan.reason === 'FILLED'
                    ? 'bg-status-ok/10 border-status-ok/30 text-status-ok-bright'
                    : 'bg-armed-amber/10 border-armed-amber/30 text-armed-amber'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">
                    {plan.reason === 'FILLED' ? 'check_circle' : 'warning'}
                  </span>
                  <span className="font-label-caps text-[11px] font-bold">
                    {`${plan.items.length} itens na proposta · ${dur(plan.window,rate)} solicitados`}
                  </span>
                </div>
                <span className="font-label-mono text-[12px]">
                  {plan.reason === 'FILLED'
                    ? `Saldo: ${dur(plan.leftover, rate)}`
                    : `Faltaram: ${dur(plan.leftover, rate)}`}
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto divide-y divide-border-subtle/40 broadcast-scroll bg-surface-base">
                {plan.items.length === 0 ? (
                  <div className="p-4 text-center text-outline text-xs">
                    Nenhum item do acervo atendeu aos critérios configurados.
                  </div>
                ) : (
                  plan.items.map((item, index) => (
                    <div
                      key={`${item.mediaId}-${index}`}
                      className="px-3 py-2 flex items-center justify-between text-body-sm hover:bg-surface-panel/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 truncate pr-2">
                        <span className="font-label-mono text-[12px] text-outline w-5 shrink-0">
                          {index + 1}.
                        </span>
                        <span className="font-label-mono text-[12px] text-primary font-bold shrink-0">
                          {dur(item.durationFrames, rate)}
                        </span>
                        <div className="flex flex-col truncate">
                          <span className="font-bold text-on-surface text-xs truncate">
                            {item.title}
                          </span>
                          <span className="text-[12px] font-label-mono text-outline truncate">
                            {item.explanation?.category ?? 'Geral'} ·{' '}
                            {item.explanation?.lastAiredAt
                              ? `Último ar: ${new Date(item.explanation.lastAiredAt).toLocaleDateString('pt-BR')}`
                              : 'Nunca exibido'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-surface-container text-outline text-[12px] font-label-mono">
                          Score {item.explanation?.preference ?? 0}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Kept mounted across tabs to preserve the original draft proof. */}
          <div hidden={mode!=='rules'}>
            <ScheduleRulesEditor key={channelId} channelId={channelId} categories={categories} disabled={busy}
              onReview={setRulesReview} onReadyChange={setRulesReady}
              onBusyChange={value=>{busyRef.current=value;setBusy(value)}}/>
          </div>
          {proposal && <div className="text-xs text-outline" role="status">
            Revisão {proposal.editorialRevision} · válida até {new Date(proposal.expiresAt).toLocaleTimeString('pt-BR')}.
            {!proposalCurrent && <p className="text-armed-amber">Os critérios mudaram. Proponha novamente antes de aplicar; a conferência anterior foi mantida.</p>}
            {bands.map((band,index)=><p key={index}>{band.rule}: {band.items} itens · saldo {dur(band.leftover,rate)}</p>)}
            {impact.length>0&&<div role="alert" className="mt-1 rounded border border-armed-amber bg-armed-amber/10 p-2 text-armed-amber">
              <p className="font-bold">Aplicar esta proposta muda {impact.length} {impact.length===1?'item que já está':'itens que já estão'} na grade (o 1º item entra com hora fixa):</p>
              <ul className="list-disc pl-4">{impact.map(row=><li key={row.itemId} title={row.reason}>{row.title}: {row.kind==='DROPPED'?`DESCARTADO (${dur(row.beforeFrames,rate)})`:`cortado de ${dur(row.beforeFrames,rate)} para ${dur(row.afterFrames,rate)}`}</li>)}</ul>
              <p>Para não cortar, escolha um horário depois do fim do conteúdo ou use "Preencher lacuna".</p>
            </div>}
            <p>Montagem editorial. Não altera o PGM nem publica automaticamente.</p>
          </div>}
        </fieldset>

        {/* RODAPÉ DE AÇÕES */}
        {operationError && <div role="alert" className="px-5 py-3 bg-error-container/20 text-on-error-container text-sm">{operationError} Os campos foram mantidos; confira a grade antes de repetir a montagem.</div>}
        <footer className="px-5 py-3.5 bg-surface-container-high border-t border-border-subtle flex items-center justify-between shrink-0">
          <button
            type="button"
            className="px-4 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface text-xs font-label-caps transition-colors cursor-pointer"
            onClick={onCancel}
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2">
            {mode !== 'rules' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(true)}
                  className="px-4 py-1.5 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface text-xs font-label-caps font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px] text-armed-amber">
                    {busy ? 'sync' : 'search'}
                  </span>
                  <span>{busy ? 'Calculando...' : 'Propor Preenchimento'}</span>
                </button>

                <button
                  type="button"
                  disabled={busy || !proposalCurrent || plan === null || plan.items.length === 0}
                  onClick={() => run(false)}
                  className="px-4 py-1.5 rounded bg-status-ok hover:brightness-110 text-surface-base text-xs font-label-caps font-bold flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,255,102,0.4)] transition-all cursor-pointer disabled:opacity-50 disabled:shadow-none"
                >
                  <span className="material-symbols-outlined text-[16px]">add_task</span>
                  <span>Aplicar na Grade</span>
                </button>
              </>
            )}

            {mode === 'rules' && (
              <>
              <button type="button" disabled={busy || !rulesReady || !rules?.length} onClick={()=>run(true)} className="px-4 py-1.5 rounded border border-border-subtle text-xs cursor-pointer disabled:opacity-50">Conferir o Dia Inteiro</button>
              <button
                type="button"
                disabled={busy || !rulesReady || !proposalCurrent || !plan?.items.length}
                onClick={fillDay}
                className="px-4 py-1.5 rounded bg-primary hover:bg-primary-fixed text-surface-base text-xs font-label-caps font-bold flex items-center gap-1.5 shadow transition-all cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                <span>Aplicar Dia Conferido</span>
              </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
