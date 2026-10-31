import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {PROJECT_SECTIONS,type ProjectRestoreReview} from '@rplayout/protocol'
import {ProjectRestoreImpact,ProjectRestorePanel} from './ProjectRestorePanel.js'
describe('conferência de impacto (markup, não homologação de navegador)',()=>{
  it('mostra todos os grupos e distinção de sinal físico sem imprimir prova privada',()=>{
    const counts=Object.fromEntries(PROJECT_SECTIONS.map(key=>[key,1])) as ProjectRestoreReview['restoring']
    const review:ProjectRestoreReview={channelId:'ch',projectId:'proj',projectRevision:1,configurationRevision:1,token:'a'.repeat(64),label:'Projeto <ã>',createdAt:'now',replacing:counts,restoring:counts,removedRundowns:2,preservedPublications:3,enabledOutputs:1,enabledDestinations:2,enabledGuests:3,formatBefore:{width:320,height:180,rateNum:25,rateDen:1,audioChannels:2},formatAfter:{width:1920,height:1080,rateNum:30000,rateDen:1001,audioChannels:8},requiresStoppedProgram:true,automaticTake:false,physicalOutputValidated:false}
    const html=renderToStaticMarkup(createElement(ProjectRestoreImpact,{review}))
    expect(html.match(/<tr>/g)).toHaveLength(13)
    for(const text of ['Projeto &lt;ã&gt;','320 × 180','1920 × 1080','30000/1001','8 canais de áudio','2 grades removidas','3 publicações preservadas','sem TAKE automático','não valida sinal físico'])expect(html).toContain(text)
    expect(html).not.toContain(review.token)
  })
  it('não apresenta confirmação antes de obter uma conferência',()=>{
    const html=renderToStaticMarkup(createElement(ProjectRestorePanel,{channelId:'ch',canRestore:true,externalBusy:false,onMessage:()=>{},onChanged:()=>{}}))
    expect(html).not.toContain('CONFIRMAR RESTAURAÇÃO');expect(html).toContain('SALVAR PONTO')
  })
})
