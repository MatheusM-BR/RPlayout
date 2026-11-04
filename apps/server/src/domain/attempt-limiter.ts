/**
 * Limite de tentativas de senha (login e reautenticação): até `max` tentativas
 * numa janela de `windowMs` por chave (estação, usuário). Mesmo comportamento
 * que o login tinha embutido: conta a tentativa antes de conferir a senha e
 * zera só no acerto.
 */
export class AttemptLimiter {
  private readonly entries=new Map<string,{count:number;until:number}>()
  constructor(private readonly max=10,private readonly windowMs=900_000,private readonly capacity=2000,private readonly now:()=>number=Date.now){}
  /** Milissegundos até liberar; 0 quando a chave pode tentar. */
  blockedFor(key:string):number{
    const entry=this.entries.get(key),now=this.now()
    return entry&&entry.until>now&&entry.count>=this.max?entry.until-now:0
  }
  /** Conta uma tentativa; false quando a tabela está cheia de chaves ativas. */
  record(key:string):boolean{
    const now=this.now(),entry=this.entries.get(key)
    if(this.entries.size>this.capacity/2)for(const [other,value] of this.entries)if(value.until<=now)this.entries.delete(other)
    if(this.entries.size>this.capacity&&!entry)return false
    this.entries.set(key,entry&&entry.until>now?{...entry,count:entry.count+1}:{count:1,until:now+this.windowMs})
    return true
  }
  clear(key:string){this.entries.delete(key)}
}
