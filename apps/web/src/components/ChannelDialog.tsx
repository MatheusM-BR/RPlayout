import { useState } from 'react'
import { formatVideoFormat, sameRate, type Channel } from '@rplayout/protocol'
import { api } from '../api.js'
import {channelConfigurationPatch} from '../domain/channel-configuration.js'
import {CadenceConversionDialog,type CadenceConversionRequest} from './CadenceConversionDialog.js'

interface Props {
  channel: Channel
  onCancel: () => void
  onSaved: (message: string) => void
}

/** Formatos padrão para emissoras e playout profissional. */
const RATES: { label: string; num: number; den: number }[] = [
  { label: '59,94', num: 60000, den: 1001 },
  { label: '29,97', num: 30000, den: 1001 },
  { label: '23,976', num: 24000, den: 1001 },
  { label: '50', num: 50, den: 1 },
  { label: '25', num: 25, den: 1 },
]

const SIZES: { label: string; width: number; height: number }[] = [
  { label: '1080p / 1080i (1920×1080)', width: 1920, height: 1080 },
  { label: '720p (1280×720)', width: 1280, height: 720 },
  { label: 'SD (720×576)', width: 720, height: 576 },
]

export function ChannelDialog({ channel, onCancel, onSaved }: Props) {
  const [baseline]=useState(()=>structuredClone(channel))
  const [name, setName] = useState(channel.name)
  const [size, setSize] = useState({ width: channel.width, height: channel.height })
  const [rate, setRate] = useState({ num: channel.rate.num, den: channel.rate.den })
  const [scan, setScan] = useState(channel.scan)
  const [fieldOrder, setFieldOrder] = useState(channel.fieldOrder)
  const [audioChannels,setAudioChannels]=useState<2|8|16>(channel.audioChannels??2)
  const [error,setError]=useState('')
  const [busy, setBusy] = useState(false)
  const [conversion,setConversion]=useState<CadenceConversionRequest|null>(null)

  const preview = formatVideoFormat({ height: size.height, rate, scan })
  const muda =
    size.width !== baseline.width ||
    size.height !== baseline.height ||
    rate.num !== baseline.rate.num ||
    rate.den !== baseline.rate.den ||
    scan !== baseline.scan ||
    fieldOrder !== baseline.fieldOrder || audioChannels!==(baseline.audioChannels??2)

  const salvar = async (): Promise<void> => {
    setError('')
    if(channel.id!==baseline.id){setError('O canal selecionado mudou. Feche e reabra a configuração; seus campos não foram enviados.');return}
    if(!sameRate(baseline.rate,rate)&&audioChannels!==(baseline.audioChannels??2)){
      setError('Altere o barramento de áudio e a cadência em etapas separadas, conferindo e publicando as grades após cada mudança.')
      return
    }
    const patch=channelConfigurationPatch(baseline,{name,width:size.width,height:size.height,rateNum:rate.num,rateDen:rate.den,scan,fieldOrder,audioChannels})
    if(!sameRate(baseline.rate,rate)){
      const {rateNum:ignoredNum,rateDen:ignoredDen,audioChannels:ignoredAudio,expectedAudioChannels:ignoredPrevious,...format}=patch
      setConversion({channel:baseline,rate,format})
      return
    }
    if(!Object.keys(patch).length){onSaved('Nenhuma configuração alterada.');return}
    setBusy(true)
    try{
      const result=await api.patchChannel(baseline.id,patch,baseline.configurationRevision)
      onSaved(result.engineError?`Configuração gravada, mas o engine exige conferência: ${result.engineError}. Confira antes de operar.`:result.formatChanged?`Configuração gravada em ${preview}. Reinício controlado solicitado; confira o estado do engine antes de operar.`:'Canal atualizado.')
    }catch(failure){setError(failure instanceof Error?failure.message:'Configuração não confirmada.')}
    finally{setBusy(false)}
  }

  if(conversion)return <CadenceConversionDialog request={conversion} onCancel={()=>setConversion(null)} onApplied={onSaved}/>
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card border border-border-subtle rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col text-on-surface"
        onClick={(event) => event.stopPropagation()}
      >
        {/* HEADER */}
        <header className="px-6 py-4 border-b border-border-subtle flex items-center justify-between bg-surface-panel/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[20px]">tune</span>
            </div>
            <div>
              <h2 className="font-headline-md text-base text-on-surface uppercase tracking-wider font-bold">
                Formato do Canal
              </h2>
              <div className="font-label-mono text-[12px] text-outline">
                Revisão aberta em <strong className="text-primary">{formatVideoFormat(baseline)}</strong> · Grade temporizada nesta cadência
              </div>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-lg hover:bg-surface-panel flex items-center justify-center text-outline hover:text-on-surface transition-colors cursor-pointer text-base font-bold"
            title="Fechar (Esc)"
          >
            ✕
          </button>
        </header>

        {/* BODY */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto broadcast-scroll max-h-[75vh]">
          {/* NOME DO CANAL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-label-caps uppercase text-outline font-bold tracking-wider">
              Nome do Canal
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-sm font-label-mono px-3 py-2 rounded-lg focus:outline-none"
            />
          </div>

          {/* RESOLUÇÃO */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-label-caps uppercase text-outline font-bold tracking-wider">
              Resolução (Raster)
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {SIZES.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`px-3 py-2 rounded-lg text-xs font-label-mono text-left cursor-pointer transition-colors border ${
                    size.width === option.width && size.height === option.height
                      ? 'bg-primary/20 border-primary text-primary font-bold'
                      : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                  }`}
                  onClick={() => setSize({ width: option.width, height: option.height })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* CADÊNCIA */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-label-caps uppercase text-outline font-bold tracking-wider">
              Taxa de Quadros (Cadência FPS)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {RATES.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-label-mono text-center cursor-pointer transition-colors border ${
                    rate.num === option.num && rate.den === option.den
                      ? 'bg-primary/20 border-primary text-primary font-bold'
                      : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                  }`}
                  onClick={() => setRate({ num: option.num, den: option.den })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* VARREDURA */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-label-caps uppercase text-outline font-bold tracking-wider">
              Varredura de Vídeo
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`px-3 py-2 rounded-lg text-xs font-label-caps font-bold cursor-pointer transition-colors border text-center ${
                  scan === 'PROGRESSIVE'
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                }`}
                onClick={() => setScan('PROGRESSIVE')}
              >
                PROGRESSIVA (P)
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-lg text-xs font-label-caps font-bold cursor-pointer transition-colors border text-center ${
                  scan === 'INTERLACED'
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                }`}
                onClick={() => setScan('INTERLACED')}
              >
                ENTRELAÇADA (I)
              </button>
            </div>
          </div>

          {/* PRIMEIRO CAMPO */}
          {scan === 'INTERLACED' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-label-caps uppercase text-outline font-bold tracking-wider">
                Ordem dos Campos (Field Order)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-label-mono cursor-pointer transition-colors border text-center ${
                    fieldOrder === 'TFF'
                      ? 'bg-primary/20 border-primary text-primary font-bold'
                      : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                  }`}
                  onClick={() => setFieldOrder('TFF')}
                >
                  SUPERIOR (TFF)
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-label-mono cursor-pointer transition-colors border text-center ${
                    fieldOrder === 'BFF'
                      ? 'bg-primary/20 border-primary text-primary font-bold'
                      : 'bg-surface-base border-border-subtle text-outline hover:text-on-surface'
                  }`}
                  onClick={() => setFieldOrder('BFF')}
                >
                  INFERIOR (BFF)
                </button>
              </div>
            </div>
          )}

          {/* NOTA INFORMATIVA */}
          <div className="p-3 rounded-lg bg-surface-panel/80 border border-border-subtle text-[12px] font-label-mono text-outline leading-relaxed">
            Formato resultante: <strong className="text-on-surface">{preview}</strong>.
            {scan === 'INTERLACED' &&
              ' Em modo entrelaçado, a grade conta quadros inteiros e o compositor renderiza em campos dobrados.'}
            {' '}Escolha a cadência do canal; revise separadamente as saídas e o perfil de QC.
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="channel-audio-bus" className="text-[11px] text-outline">Canais de áudio do PGM / SDI</label>
            <select id="channel-audio-bus" value={audioChannels} onChange={event=>setAudioChannels(Number(event.target.value) as 2|8|16)} className="bg-surface-panel p-2 border border-border-subtle rounded text-xs">
              <option value={2}>2 · Master estéreo</option><option value={8}>8 · Master + 3 pares auxiliares</option><option value={16}>16 · Master + 7 pares auxiliares</option>
            </select>
            <p className="text-[11px] text-outline">Auxiliares são definidos no áudio de cada item. Preview/saídas de rede continuam estéreo. Mudar este total exige PGM parado, CUE limpo e nova publicação; não comprova uma saída SDI física.</p>
          </div>
          {error&&<p role="alert" className="text-xs text-on-air-crimson">{error}</p>}
          {channel.configurationRevision!==baseline.configurationRevision&&<p role="alert" className="text-xs text-armed-amber">A configuração mudou enquanto esta janela estava aberta. Seus campos foram conservados. Feche e reabra para conferir a nova configuração antes de aplicar.</p>}
          {/* AVISO DE RECONSTRUÇÃO */}
          {muda && (
            <div className="p-3 rounded-lg bg-armed-amber/10 border border-armed-amber/30 text-[12px] font-label-mono text-armed-amber flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">warning</span>
              <span>
                Alterar o formato recria o pipeline e provoca uma interrupção controlada. Mudar FPS ou o total de canais de áudio exige PGM parado e CUE limpo, revisão e nova publicação das grades, sem TAKE automático.
              </span>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <footer className="px-6 py-3.5 border-t border-border-subtle flex items-center justify-end gap-2 bg-surface-panel/40 shrink-0">
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-surface-panel hover:bg-surface-panel/80 border border-border-subtle text-xs font-label-caps text-on-surface font-bold cursor-pointer transition-colors"
            onClick={onCancel}
          >
            CANCELAR
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={salvar}
            className="px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'APLICANDO…' : 'APLICAR FORMATO'}
          </button>
        </footer>
      </div>
    </div>
  )
}
