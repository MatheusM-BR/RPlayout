import {it,expect} from 'vitest'
import type {ScanReview,ScanCommandResult} from '@rplayout/protocol'
import {captureScanOperation,scanOperationKey,validateScanResult,scanResultNotice} from './scan-operation.js'
const folder={id:'a',path:'C:\\Acervo São José Çãó',label:'Çãó',present:true}
const review=():ScanReview=>({revision:3,batchRevision:8,operationId:'218d0837-2532-44e5-bfa2-40c88ff0f488',canEdit:true,available:true,canStart:true,roots:[{...folder}],activeBatches:[]})
const result=():ScanCommandResult=>({accepted:true,batchId:'batch-a',state:'PENDING',deduplicated:false,roots:[folder.path],measure:false})
it('captura profunda preserva identidade/revisões/pastas originais em repetição',()=>{
  const original=review(),operation=captureScanOperation(original,false,folder.path),key=scanOperationKey(operation)
  original.operationId='new';original.revision++;original.roots[0]!.path='D:\\changed'
  expect(operation.review.operationId).not.toBe('new');expect(operation.review.revision).toBe(3)
  expect(operation.review.roots[0]!.path).toBe(folder.path);expect(scanOperationKey(operation)).toBe(key)
})
it('modo, raiz, UUID, revisão e tipo participam do consentimento',()=>{
  const original=review();original.roots.push({id:'b',path:'D:\\Ó',label:'Ó',present:true})
  const base=scanOperationKey(captureScanOperation(original,false))
  const variants=[captureScanOperation(original,true),captureScanOperation(original,false,folder.path),captureScanOperation({...original,operationId:'other'},false),captureScanOperation({...original,revision:4},false),captureScanOperation({...original,batchRevision:9},false)]
  for(const variant of variants)expect(scanOperationKey(variant)).not.toBe(base)
})
it('sonda ausente, raiz arbitrária ou fila ocupada não geram intenção de scan',()=>{
  for(const original of [{...review(),canEdit:false},{...review(),available:false},{...review(),canStart:false},{...review(),roots:[]}])expect(()=>captureScanOperation(original,false)).toThrow()
  expect(()=>captureScanOperation(review(),false,'D:\\outro')).toThrow()
})
it('retomada só captura lote explicitamente autorizado na conferência',()=>{
  const original=review();original.activeBatches=[{id:'old',state:'RUNNING',ownership:'LOCAL_ALIVE',canRecover:false,message:'Protegido'}]
  expect(()=>captureScanOperation(original,false,undefined,'old')).toThrow()
  expect(()=>captureScanOperation(original,false,undefined,'missing')).toThrow()
  original.activeBatches[0]!.canRecover=true
  expect(captureScanOperation(original,false,undefined,'old').kind).toBe('RECOVER')
})
it('recibo de scan deve preservar modo e conjunto exato de pastas',()=>{
  const operation=captureScanOperation(review(),false)
  expect(validateScanResult(operation,result()).state).toBe('PENDING')
  for(const response of [{...result(),measure:true},{...result(),roots:['D:\\other']},{...result(),roots:[folder.path,folder.path]}])expect(()=>validateScanResult(operation,response)).toThrow()
})
it('resposta de outra retomada é recusada; modo antigo do lote não é reescrito pelo diálogo',()=>{
  const original=review();original.activeBatches=[{id:'old',state:'RUNNING',ownership:'LOCAL_DEAD',canRecover:true,message:'Encerrado'}]
  const operation=captureScanOperation(original,false,undefined,'old')
  expect(()=>validateScanResult(operation,result())).toThrow()
  expect(validateScanResult(operation,{...result(),batchId:'old',measure:true,roots:['D:\\raiz histórica']})).toMatchObject({batchId:'old',measure:true})
})
it('retorno sem confirmação não anuncia aceitação',()=>{
  const operation=captureScanOperation(review(),false)
  for(const response of [null,{...result(),accepted:false},{...result(),batchId:''},{...result(),state:''},{...result(),deduplicated:undefined},{...result(),roots:[]}])expect(()=>validateScanResult(operation,response as ScanCommandResult)).toThrow()
})
it('repetição aceita estado real COMPLETED/UNKNOWN, sem inferir conclusão do registro',()=>{
  const operation=captureScanOperation(review(),false)
  for(const state of ['COMPLETED','UNKNOWN'])expect(validateScanResult(operation,{...result(),state,deduplicated:true}).state).toBe(state)
})
it('mensagem distingue registro, conclusão, falha e estado desconhecido sem inferir QC',()=>{
  expect(scanResultNotice(result())).toContain('Registro não significa leitura concluída')
  expect(scanResultNotice({...result(),state:'COMPLETED'})).toContain('não aprova a mídia no QC')
  expect(scanResultNotice({...result(),state:'UNKNOWN'})).toContain('não presumir conclusão')
  expect(scanResultNotice({...result(),state:'FAILED'})).toContain('falha do lote')
  expect(scanResultNotice({...result(),startError:'Sonda indisponível.'})).toContain('Sonda indisponível.')
})
