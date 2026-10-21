import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it,vi} from 'vitest'
import {QcInspectionControls} from '../components/broadcast/QcInspectionControls.js'

function markup(overrides:Partial<Parameters<typeof QcInspectionControls>[0]>={}){
  const onToggleQuality=vi.fn(),onFullscreen=vi.fn()
  const html=renderToStaticMarkup(createElement(QcInspectionControls,{hasAsset:true,isLive:false,qualityActive:false,framesOnly:false,onToggleQuality,onFullscreen,...overrides}))
  expect(onToggleQuality).not.toHaveBeenCalled()
  expect(onFullscreen).not.toHaveBeenCalled()
  return html
}
describe('barra de qualidade do QC',()=>{
  it('fica separada do timecode, oferece original por escolha e não ativa durante render',()=>{
    const html=markup()
    expect(html).toContain('aria-label="Qualidade da inspeção"')
    expect(html).toContain('Ver em qualidade')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Preview leve')
    expect(html).toContain('Inspecionar imagem em tela cheia')
    expect(html).not.toContain('Original selecionado')
  })
  it('seleção do original oferece retorno e informa custo sem afirmar playback confirmado',()=>{
    const html=markup({qualityActive:true})
    expect(html).toContain('Voltar ao preview leve')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Original selecionado')
    expect(html).toContain('depende dos codecs')
  })
  it('fallback por quadros não anuncia reprodução ou conferência de áudio',()=>{
    const html=markup({qualityActive:true,framesOnly:true})
    expect(html).toContain('Quadros do original')
    expect(html).toContain('Sem reprodução contínua ou conferência de áudio')
    expect(html).not.toContain('Original selecionado')
  })
  it('live oferece qualidade codificada com retorno, custo e limites explícitos, nunca original sem perdas',()=>{
    const html=markup({hasAsset:false,isLive:true,qualityActive:true})
    expect(html).toContain('Ao vivo · decodificador próprio do QC, até 4K/60 fps')
    expect(html).toContain('6–50 Mbps');expect(html).toContain('Não usa o PVW do Master')
    expect(html).toContain('Inspecionar imagem em tela cheia')
    expect(html).not.toContain('Ver em qualidade')
    expect(html).toContain('Pausar inspeção')
    expect(html).not.toContain('Original selecionado')
  })
  it('live pausado oferece abrir no decodificador do QC, sem PVW do Master',()=>{
    const html=markup({hasAsset:false,isLive:true})
    expect(html).toContain('o PVW do Master não é usado');expect(html).toContain('Abrir inspeção')
    expect(html).toContain('aria-pressed="false"');expect(html).not.toContain('Voltar ao preview leve')
  })
  it('sem mídia não oferece inspeção nem tela cheia vazia',()=>{
    expect(markup({hasAsset:false})).toBe('')
  })
})
