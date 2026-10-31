import type {Rate} from './rate.js'

export interface CadenceConversionReport {
  channelId:string;from:Rate;to:Rate;fingerprint:string
  rundowns:number;items:number;events:number;roundedValues:number
  maxRoundingErrorMs:number;inheritedTrims:number;activeRevisions:number
  pendingInterruptions:number;warnings:string[]
}
export const sameRate=(left:Rate,right:Rate)=>[left.num,left.den,right.num,right.den].every(value=>Number.isSafeInteger(value)&&value>0) && BigInt(left.num)*BigInt(right.den)===BigInt(right.num)*BigInt(left.den)
export function validateCadence(rate:Rate):void {
  if(!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0||rate.num/rate.den<1||rate.num/rate.den>240)throw new Error('Cadência inválida: informe uma taxa racional entre 1 e 240 quadros/s.')
}

/** Exact rational arithmetic; round nearest, half up. No accumulated float
 * drift over hours and no fractional/unsafe frame values in persistence. */
export function frameConverter(from:Rate,to:Rate){
  validateCadence(from);validateCadence(to)
  let roundedValues=0,maxRoundingErrorMs=0
  const numerator=BigInt(to.num)*BigInt(from.den),denominator=BigInt(from.num)*BigInt(to.den)
  const frames=(value:number):number=>{
    if(!Number.isSafeInteger(value)||value<0)throw new Error('Conversão recusada: valor de quadros inválido.')
    const exact=BigInt(value)*numerator,result=(2n*exact+denominator)/(2n*denominator)
    if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Conversão excede o limite seguro de quadros.')
    const difference=result*denominator-exact,absolute=difference<0n?-difference:difference
    if(absolute){roundedValues++;maxRoundingErrorMs=Math.max(maxRoundingErrorMs,Number(absolute)/Number(denominator)*to.den/to.num*1000)}
    return Number(result)
  }
  return {frames,statistics:()=>({roundedValues,maxRoundingErrorMs})}
}
