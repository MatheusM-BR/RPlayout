interface Props {
  hasAsset: boolean
  isLive: boolean
  qualityActive: boolean
  framesOnly: boolean
  onToggleQuality: () => void
  onFullscreen: () => void
}

/** Inspection controls are separate from timecode so approval actions stay visible. */
export function QcInspectionControls({hasAsset,isLive,qualityActive,framesOnly,onToggleQuality,onFullscreen}:Props) {
  if (!hasAsset && !isLive) return null
  const original = !isLive && qualityActive
  return <div aria-label="Qualidade da inspeção" className="px-3 py-2 border-b border-border-subtle flex flex-wrap items-center gap-2 bg-surface-panel/20">
    <button type="button" aria-pressed={qualityActive}
      title={isLive?'Inspeção codificada no raster recebido, até 4K/60 fps, 6–50 Mbps conforme a fonte. Mesmo decoder, sem alterar PGM; maior consumo de rede/CPU.':'Carrega o arquivo original para aprovação. Consome mais rede e processamento; não altera PGM nem aprova automaticamente.'}
      onClick={onToggleQuality}
      className={`px-3 py-1.5 rounded border font-label-caps text-[11px] cursor-pointer shrink-0 ${qualityActive?'border-primary bg-primary/15 text-primary':'border-primary text-primary hover:bg-primary/10'}`}>
      {isLive?(qualityActive?'Pausar inspeção':'Abrir inspeção'):qualityActive?'Voltar ao preview leve':'Ver em qualidade'}
    </button>
    <span role="status" className="text-[11px] text-outline flex-1 min-w-[160px]">
      {isLive?(qualityActive?'Ao vivo · decodificador próprio do QC, até 4K/60 fps · 6–50 Mbps. Não usa o PVW do Master.':'Ao vivo · inspeção pausada (o PVW do Master não é usado)'):original
        ?framesOnly?'Quadros do original · até 4K. Sem reprodução contínua ou conferência de áudio.':'Original selecionado · maior consumo de rede. Reprodução depende dos codecs do navegador.'
        :'Preview leve · menor consumo de rede. Use qualidade para conferir o original.'}
    </span>
    <button type="button" aria-label="Inspecionar imagem em tela cheia" title="Inspecionar imagem em tela cheia"
      onClick={onFullscreen} className="text-primary cursor-pointer shrink-0 p-1">
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">fullscreen</span>
    </button>
  </div>
}
