import {afterEach,describe,expect,it,vi} from 'vitest'
import type {AssetMetadataReview} from '@rplayout/protocol'
import {assetMetadataHeaders,isCatalogMediaAsset} from './asset-metadata-review.js'
import {api} from '../api.js'
const review:AssetMetadataReview={assetId:'asset:ç',title:'AÇÃO',categoryId:'Notícias',revision:19,canEdit:true}
afterEach(()=>vi.unstubAllGlobals())
describe('web metadata guarda sua prova, separada do QC',()=>{
  it('entrada ao vivo não recebe metadata/QC de arquivo, mesmo com ID coincidente',()=>{
    const file={id:'same',isLiveSource:false},live={id:'same',isLiveSource:true}
    expect(isCatalogMediaAsset(file)).toBe(true);expect(isCatalogMediaAsset(live)).toBe(false)
  })
  it('arquivo da categoria Ao Vivo continua sendo arquivo, não entrada de rede',()=>{
    const file={id:'file',categoryId:'Ao Vivo',isLiveSource:undefined}
    expect(isCatalogMediaAsset(file)).toBe(true)
  })
  it('prova original Unicode e dono exato, sem presumir versão',()=>{
    expect(assetMetadataHeaders(review.assetId,review)).toEqual({'If-Match':'"asset-metadata:asset%3A%C3%A7:19"'});expect(()=>assetMetadataHeaders('other',review)).toThrow('outro')
  })
  it.each([0,-1,NaN,Number.MAX_SAFE_INTEGER+1])('versão inválida %s bloqueia antes da requisição',revision=>expect(()=>assetMetadataHeaders(review.assetId,{...review,revision})).toThrow())
  it('PATCH envia só a conferência original, sem GET para renovar autorização',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({...review,revision:20,applied:true,automaticTake:false,refreshError:null}),{status:200}));vi.stubGlobal('fetch',fetch)
    await api.patchAssetMetadata(review.assetId,{title:'New'},review);expect(fetch).toHaveBeenCalledTimes(1)
    const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toContain('/asset%3A%C3%A7/metadata');expect(init.method).toBe('PATCH');expect(new Headers(init.headers).get('If-Match')).toBe('"asset-metadata:asset%3A%C3%A7:19"')
  })
  it('rota legada também exige prova e recusa mix QC/metadata antes de fetch',async()=>{
    const fetch=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetch)
    expect(()=>api.patchAsset(review.assetId,{title:'Blind'})).toThrow();expect(()=>api.patchAsset(review.assetId,{title:'Mixed',ignored:true},19)).toThrow('separadamente');expect(fetch).not.toHaveBeenCalled()
    await api.patchAsset(review.assetId,{categoryId:'AÇÃO'},19);const [,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(new Headers(init.headers).get('If-Match')).toBe('"asset-metadata:asset%3A%C3%A7:19"')
  })
  it('conflito não refaz PATCH nem busca revisão nova',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({error:'Mudou; campos preservados'}),{status:409}));vi.stubGlobal('fetch',fetch)
    await expect(api.patchAssetMetadata(review.assetId,{title:'Draft'},review)).rejects.toThrow('Mudou');expect(fetch).toHaveBeenCalledTimes(1)
  })
})
