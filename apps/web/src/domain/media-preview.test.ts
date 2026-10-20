import {describe,expect,it} from 'vitest'
import {lightweightPreviewUrl,qcOriginalUrl,qcQualityFrameUrl,qcQualitySelected,qcInspectionUsesFrames,qcMonitorLabels,qcInspectionFrameAtTime,qcInspectionVideoHasPicture,qcQualityFrameFailed} from './media-preview.js'

describe('preview econômico nunca seleciona o arquivo original',()=>{
  it.each([
    [true,true,null,null,false],
    [false,true,null,null,false],
    [false,true,'','',false],
    [false,true,'/frame/2?hash=A','/frame/2?hash=A',true],
    [false,true,'/frame/2?hash=B','/frame/2?hash=A',false],
    [false,false,'/frame/2','/frame/2',false],
    [true,true,'/frame/2','/frame/2',false],
  ] as const)('falha JPEG exige pedido de arquivo atual, não invalida WHEP ao vivo (%s/%s/%s)',(live,frames,request,failed,unavailable)=>{
    expect(qcQualityFrameFailed(live,frames,request,failed)).toBe(unavailable)
  })
  it.each([[0,0,false],[640,0,false],[0,360,false],[NaN,360,false],[640,Infinity,false],[426,240,true],[360,640,true]])('metadata %s×%s exige imagem e não só áudio',(width,height,picture)=>{
    expect(qcInspectionVideoHasPicture(width,height)).toBe(picture)
  })
  it('original usa pontos de extração nativos, não intervalos da miniatura',()=>{
    expect(qcInspectionFrameAtTime(8,10,24,true)).toBe(18)
    expect(qcInspectionFrameAtTime(8,10,24,false)).toBe(19)
    expect(qcInspectionFrameAtTime(10,10,24,true)).toBe(23)
    expect(qcInspectionFrameAtTime(4,10,1,true)).toBe(0)
  })
  it.each([
    [0,10,0],[5,10,12],[10,10,23],[12,10,23],[-2,10,0],
    [5,0,0],[NaN,10,0],[5,Infinity,0],
  ])('fallback mantém quadro finito na posição %s de %s',(seconds,duration,frame)=>{
    expect(qcInspectionFrameAtTime(seconds,duration)).toBe(frame)
  })
  it.each([
    [false,false,false,'proxy leve','PICOS DO PROXY'],
    [false,true,false,'player do original','PICOS DO PLAYER'],
    [false,true,true,'quadros JPEG do original','SEM ESCUTA'],
    [false,false,true,'quadros de navegação','SEM ESCUTA'],
    [true,true,true,'inspeção ao vivo codificada','PICOS DA INSPEÇÃO'],
    [true,false,true,'preview ao vivo','PICOS DO PREVIEW'],
  ] as const)('identifica a fonte montada sem afirmar escuta de quadros ou original ao vivo (%s/%s/%s)',(live,quality,frames,image,audio)=>{
    expect(qcMonitorLabels(live,quality,frames)).toEqual({image,audio})
  })
  it.each([
    [null,false,true],
    [null,true,true],
    ['',false,true],
    ['/proxy.mp4',false,false],
    ['/original.mp4',false,false],
    ['/original.mp4',true,true],
  ] as const)('controles e scopes usam o modo exibido para URL %s / erro %s', (url,error,frames)=>{
    expect(qcInspectionUsesFrames(url,error)).toBe(frames)
  })
  it('solicita proxy e mantém a identidade de conteúdo exibida',()=>{
    const url=new URL(lightweightPreviewUrl({id:'input/?#Ç',contentHash:'hash &+'}),'http://localhost')
    expect(url.pathname).toBe('/api/assets/input%2F%3F%23%C3%87/media')
    expect(url.searchParams.get('preview')).toBe('1')
    expect(url.searchParams.get('hash')).toBe('hash &+')
  })
  it('qualidade do QC só ativa para arquivo, edição e canal conferidos, nunca por padrão ou para live',()=>{
    const asset={id:'vt',contentHash:'hash'},selection={id:'vt',hash:'hash',channelId:'ch'}
    expect(qcQualitySelected(null,asset,'ch',false)).toBe(false)
    expect(qcQualitySelected(selection,asset,'ch',false)).toBe(true)
    expect(qcQualitySelected(selection,{...asset,contentHash:'outro'},'ch',false)).toBe(false)
    expect(qcQualitySelected(selection,{...asset,id:'outro'},'ch',false)).toBe(false)
    expect(qcQualitySelected(selection,asset,'outro',false)).toBe(false)
    expect(qcQualitySelected(selection,asset,'ch',true)).toBe(false)
  })
  it('qualidade explícita e quadro de inspeção mantêm hash, sem pedir proxy nem pathname do servidor',()=>{
    const asset={id:'vídeo/?',contentHash:'versão&+'}
    for(const source of [qcOriginalUrl(asset),qcQualityFrameUrl(asset,7)]){
      const url=new URL(source,'http://localhost')
      expect(url.searchParams.get('quality')).toBe('original')
      expect(url.searchParams.get('hash')).toBe(asset.contentHash)
      expect(url.searchParams.has('preview')).toBe(false)
    }
    expect(qcQualityFrameUrl(asset,7)).toContain('/frame/7.jpg?total=24')
  })
})
