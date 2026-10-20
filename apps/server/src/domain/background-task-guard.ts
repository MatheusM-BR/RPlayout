/** Contain scheduled failures without reopening storage, replaying work or
 * issuing native commands. A lost storage generation stays suspended until a
 * new guard/app is constructed; in-flight effects are NOT undone/cancelled. */
export class BackgroundTaskGuard {
  private closed=false
  private suspended=false
  constructor(
    private readonly connected:()=>boolean,
    private readonly onUnavailable:()=>unknown,
    private readonly onError:(task:string,error:unknown)=>unknown,
  ){}
  status(){return {closed:this.closed,suspended:this.suspended}}
  close(){this.closed=true}
  private async report(task:string,error:unknown){
    try{await this.onError(task,error)}catch{try{console.error('RPlayout: falha no diagnóstico de tarefa em segundo plano.')}catch{}}
  }
  private async suspend(){
    if(this.suspended)return
    this.suspended=true
    try{await this.onUnavailable()}catch(error){await this.report('storage-unavailable-notification',error)}
  }
  async run(task:string,work:()=>unknown,allowed:()=>boolean=()=>true):Promise<void>{
    if(this.closed||this.suspended)return
    try{
      if(!this.connected()){await this.suspend();return}
      if(!allowed())return
      await work()
      // A domain may have consumed its own error while poisoning storage.
      if(!this.connected())await this.suspend()
    }catch(error){
      let connected=false;try{connected=this.connected()}catch{}
      if(!connected)await this.suspend()
      await this.report(task,error)
    }
  }
}
