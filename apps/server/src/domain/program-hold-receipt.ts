export type ProgramHoldExpected={itemId:string;decoderId:number;on:boolean}
export type ProgramHoldReceipt={event:'programHold';id:number;itemId:string;decoderId:number;held:boolean;frames:number}
export type ProgramHoldState={itemId:string;decoderId:number;status:'RUNNING'|'HELD'|'UNCONFIRMED';frames:number|null}
export type ProgramHoldRestoreExpected={itemId:string;frames:number}

export function programHoldRestoreExpected(command:Record<string,unknown>):ProgramHoldRestoreExpected{
  const item=command.item as Record<string,unknown>|undefined
  if(!item||typeof item.itemId!=='string'||!item.itemId||typeof item.path!=='string'||!item.path||item.source!=null||!Number.isSafeInteger(item.trimIn)||Number(item.trimIn)<0||!Number.isSafeInteger(item.trimOut)||Number(item.trimOut)<=Number(item.trimIn)||!Number.isSafeInteger(item.startOffsetFrames)||Number(item.startOffsetFrames)<0||Number(item.startOffsetFrames)>=Number(item.trimOut)-Number(item.trimIn))throw new Error('Restauração pausada exige arquivo, corte e cursor explícitos.')
  return {itemId:item.itemId,frames:item.startOffsetFrames as number}
}

export function matchesProgramHoldRestoreReceipt(value:unknown,id:number,expected:ProgramHoldRestoreExpected):value is ProgramHoldReceipt{
  if(!value||typeof value!=='object')return false
  const event=value as Record<string,unknown>
  return event.event==='programHold'&&event.id===id&&event.itemId===expected.itemId&&event.held===true&&event.frames===expected.frames&&Number.isSafeInteger(event.decoderId)&&Number(event.decoderId)>0
}

export function parseProgramHoldState(value:unknown,itemId:string|null,decoderId:number|undefined):ProgramHoldState|null{
  if(!value||typeof value!=='object')return null
  const state=value as Record<string,unknown>
  if(!itemId||state.itemId!==itemId||state.decoderId!==decoderId||!Number.isSafeInteger(decoderId)||Number(decoderId)<=0)return null
  if(state.status==='HELD'){
    if(!Number.isSafeInteger(state.frames)||Number(state.frames)<0)return null
  }else if((state.status!=='RUNNING'&&state.status!=='UNCONFIRMED')||state.frames!==null)return null
  return state as ProgramHoldState
}

export function programHoldExpected(command:Record<string,unknown>):ProgramHoldExpected {
  if(typeof command.itemId!=='string'||!command.itemId||!Number.isSafeInteger(command.decoderId)||Number(command.decoderId)<=0||typeof command.on!=='boolean')throw new Error('Pausa exige item, geração nativa e estado explícitos.')
  return {itemId:command.itemId,decoderId:command.decoderId as number,on:command.on}
}

export function matchesProgramHoldReceipt(value:unknown,id:number,expected:ProgramHoldExpected):value is ProgramHoldReceipt {
  if(!value||typeof value!=='object')return false
  const event=value as Record<string,unknown>
  return event.event==='programHold'&&event.id===id&&event.itemId===expected.itemId&&event.decoderId===expected.decoderId&&event.held===expected.on&&Number.isSafeInteger(event.frames)&&Number(event.frames)>=0
}
