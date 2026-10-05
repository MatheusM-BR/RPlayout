import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {QualityControlView} from '../views/QualityControlView.js'
import type {LibraryAsset,LibraryFolder} from '../types.js'
import type {Channel} from '@rplayout/protocol'
const channel:Channel={id:'ch',name:'QC',rate:{num:25,den:1},width:1920,height:1080,scan:'PROGRESSIVE',fieldOrder:'TFF',targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,programSdiDeviceId:null,slateTemplateId:null,createdAt:'now'}
const asset:LibraryAsset={id:'vt',title:'Aprovação',path:'C:/ação.mxf',fileName:'ação.mxf',thumbnailUrl:'/thumb',contentHash:'hash',kind:'VIDEO',
  durationFrames:2500,durationNs:100_000_000_000,probe:null,probeError:null,categoryId:null,defaultTrim:null,defaultAudio:null,loudnessFile:null,
  suggestedTrim:null,qcStatus:'PENDING',qcNotes:null,qcCheckedAt:null,createdAt:'now'}
const folder:LibraryFolder={key:'root',rootId:'root',rootLabel:'Acervo',path:'',name:'Acervo',assets:[asset]}
const noop=()=>{}
function markup(folders:LibraryFolder[]){return renderToStaticMarkup(createElement(QualityControlView,{folders,channel,scan:null,onAccept:noop,onIgnore:noop,onScan:noop,onNavigate:noop}))}
describe('QC disponibiliza inspeção explícita sem ativar qualidade ao abrir',()=>{
  it('arquivo pendente tem botão de qualidade, tela cheia e safe desligado; HTML não pede original',()=>{
    const html=markup([folder])
    expect(html).toContain('Ver em qualidade');expect(html).toContain('fullscreen')
    expect(html).not.toContain('quality=original');expect(html).not.toContain('ACTION SAFE (90%)')
    expect(html).toContain('SAFE AREAS');expect(html).not.toContain('Voltar ao preview leve')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Inspeção por quadros — use a régua"/)
    expect(html).not.toContain('group-hover:scale-110')
    expect(html).toContain('SEM ESCUTA')
    expect(html).not.toContain('PICOS DO PROXY')
    expect(html).toContain('Scopes · quadros de navegação')
  })
  it('sem arquivo selecionado não oferece download original ou aprovação de vídeo inexistente',()=>{
    expect(markup([])).not.toContain('Ver em qualidade')
  })
})
