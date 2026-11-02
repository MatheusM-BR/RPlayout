// NOT_RUN: contratos de intenção/prova; não são confirmação de engine real.
import {it,expect} from 'vitest'
import {haControlRequest,haControlReport,haControlReviewRequest} from './ha-control.js'
const request={requestId:'12345678-1234-4234-8234-123456789abc',promotionId:'22345678-1234-4234-8234-123456789abc',channelId:'ch',revisionId:'edition',action:'CUE',itemId:'live'}
const base={version:1,request,phase:'CONFIRMED',actor:'admin',updatedAt:'2026-10-11T00:00:00.000Z',confirmationIsHistorical:true,physicalOutputValidated:false}
const ownerId='32345678-1234-4234-8234-123456789abc'
it('CUE aceito não equivale a sinal confirmado — NOT_RUN',()=>{
  expect(haControlReport.parse({...base,proof:{itemId:'live',ownerId,term:2,programChanged:false,signalConfirmed:false}}).proof).toMatchObject({signalConfirmed:false})
})
it('TAKE exige prova de decoder nativo do item exato — NOT_RUN',()=>{
  const take={...base,request:{...request,action:'TAKE'}}
  expect(haControlReport.safeParse(take).success).toBe(false)
  expect(haControlReport.safeParse({...take,proof:{itemId:'live',ownerId,term:2,programChanged:false,signalConfirmed:false}}).success).toBe(false)
  expect(haControlReport.safeParse({...take,proof:{itemId:'other',decoderId:1,ownerId,term:2,elapsed:0,nativeConfirmed:true}}).success).toBe(false)
  expect(haControlReport.safeParse({...take,proof:{itemId:'live',decoderId:1,ownerId,term:2,elapsed:0,nativeConfirmed:true}}).success).toBe(true)
})
it('não aceita nome/endereço de fonte avulsa fora da intenção publicada — NOT_RUN',()=>{
  expect(haControlRequest.safeParse({...request,source:'ndi:other'}).success).toBe(false)
})
it('revisão não aceita prova fabricada pelo cliente e exige conferência — NOT_RUN',()=>{
  const review={reviewId:'42345678-1234-4234-8234-123456789abc',requestId:request.requestId,channelId:'ch',reviewToken:'conferencia'}
  expect(haControlReviewRequest.safeParse(review).success).toBe(true)
  expect(haControlReviewRequest.safeParse({...review,proof:{nativeConfirmed:true}}).success).toBe(false)
  expect(haControlReviewRequest.safeParse({...review,reviewToken:''}).success).toBe(false)
})
