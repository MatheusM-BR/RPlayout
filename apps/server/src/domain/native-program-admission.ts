import {z} from 'zod'
import type {ProgramTrim} from './program-trim.js'
const frame=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const cursorSchema=z.object({elapsed:frame,firstVideoConfirmed:z.boolean(),paused:z.boolean().optional(),
  trim:z.object({in:frame,out:frame}).strict().refine(cut=>cut.out>cut.in).nullable()}).strict()
export type NativeProgramAdmission={channelId:string;ownerId:string;term:number;itemId:string|null;decoderId:number|null;elapsed:number;firstVideoConfirmed:boolean;programTrim?:ProgramTrim;paused?:boolean}
/** Private stdout only. Hash is verified by the server/candidate, not asserted
 * to have been hashed by the native decoder. Reject legacy/missing wire proof. */
export function readNativeProgramAdmissionCursor(value:unknown,expected:{itemId:string|null;minimumElapsed:number;trim:ProgramTrim|null;paused?:boolean}){
  const cursor=cursorSchema.parse(value)
  if(expected.paused?cursor.paused!==true:cursor.paused===true)throw new Error('Modo pausado nativo não corresponde à admissão solicitada.')
  if(expected.paused&&(!expected.itemId||!expected.trim||cursor.elapsed!==expected.minimumElapsed))throw new Error('Admissão pausada exige arquivo/corte e cursor exato.')
  if(expected.itemId===null){
    if(cursor.elapsed!==0||cursor.firstVideoConfirmed||cursor.trim!==null)throw new Error('Admissão idle recebeu cursor/vídeo inesperados.')
  }else{
    if(!cursor.firstVideoConfirmed||cursor.elapsed<expected.minimumElapsed)throw new Error('Decoder não confirmou primeiro quadro/posição da retomada.')
    if(expected.trim){
      if(!cursor.trim||cursor.trim.in!==expected.trim.in||cursor.trim.out!==expected.trim.out||cursor.elapsed>=expected.trim.out-expected.trim.in)throw new Error('Corte/posição nativos divergem do VT preparado.')
    }else if(cursor.trim!==null)throw new Error('Admissão de live não pode apresentar corte de arquivo.')
  }
  return cursor
}
