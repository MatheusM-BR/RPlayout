import { describe, expect, it } from 'vitest'
import { DEFAULT_QC_PROFILE } from '@rplayout/protocol'
import { resolveTakeTarget } from './take-target.js'
import type { RundownView } from './plan.js'
import type { TransportState } from './transport.js'

const execution = { items: [{ item: { id: 'first' } }, { item: { id: 'next' } }, { item: { id: 'live', sourceRef: 'ndi:CAM' } }] } as unknown as RundownView
const state = { onAir: { itemId: 'first' }, preview: null } as TransportState
describe('contrato compartilhado de destino TAKE', () => {
  const fileView=(status='APPROVED',profile={requireAudio:false})=>({channel:{qcProfile:{...DEFAULT_QC_PROFILE,...profile}},items:[{item:{id:'file',mediaId:'asset',type:'VT'},asset:{kind:'VIDEO',qcStatus:status,ignored:false,probeError:null,durationNs:1e9,probe:{width:320,height:180,rate:{num:25,den:1},hasAudio:false,interlaceMode:'progressive'}}}]}) as unknown as RundownView
  it.each(['PENDING','ANALYSIS','REJECTED','FAILED','BLOCKED'])('refuses %s after selection before native command',status=>{
    expect(()=>resolveTakeTarget(fileView(status),state,'file')).toThrow('PGM anterior preservado')
    try{resolveTakeTarget(fileView(status),state,'file')}catch(error){expect(error).toHaveProperty('statusCode',409)}
  })
  it('checks current profile rather than prior approval only',()=>{
    expect(resolveTakeTarget(fileView(),state,'file').itemId).toBe('file')
    expect(()=>resolveTakeTarget(fileView('APPROVED',{requireAudio:true}),state,'file')).toThrow('perfil técnico atual')
  })
  it('sem CUE não escolhe o Próximo', () => {
    expect(() => resolveTakeTarget(execution, state)).toThrow('Próximo é uma operação distinta')
  })
  it('segue o item CUE, não a posição seguinte da lista', () => {
    expect(resolveTakeTarget(execution, { ...state, preview: { kind: 'ITEM', id: 'live' } }).itemId).toBe('live')
  })
  it('inspeção MAM/QC não vira item de programa', () => {
    expect(() => resolveTakeTarget(execution, { ...state, preview: { kind: 'ASSET', id: 'mam' } })).toThrow('inspeção')
  })
  it('fonte direta precisa de um único evento na playlist operacional', () => {
    const preview = { kind: 'SOURCE' as const, source: 'ndi:CAM' }
    expect(resolveTakeTarget(execution, { ...state, preview }).itemId).toBe('live')
    const duplicate = { ...execution, items: [...execution.items, execution.items[2]!] }
    expect(() => resolveTakeTarget(duplicate, { ...state, preview })).toThrow('mais de um evento')
    expect(() => resolveTakeTarget(execution, { ...state, preview: { ...preview, source: 'omt:MISSING' } })).toThrow('adicionada à grade')
  })
  it('CUE antigo e alvo explícito de outra revisão são recusados', () => {
    expect(() => resolveTakeTarget(execution, { ...state, preview: { kind: 'ITEM', id: 'old' } })).toThrow('playlist operacional ativa')
    expect(() => resolveTakeTarget(execution, state, 'other')).toThrow('playlist operacional ativa')
  })
  it('integração pode especificar item publicado, sem fallback para ID vazio', () => {
    expect(resolveTakeTarget(execution, state, 'next').itemId).toBe('next')
    expect(() => resolveTakeTarget(execution, state, '')).toThrow('CUE/PVW')
  })
})
