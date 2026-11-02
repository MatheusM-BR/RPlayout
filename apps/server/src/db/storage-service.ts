import Database from 'better-sqlite3'

// Private inherited IPC only: no listener, HTTP endpoint, credentials or SQL
// port exposed to the LAN. One connection belongs to one backend incarnation.
const file=process.env.RPLAYOUT_STORAGE_FILE
if(!process.send||!file)throw new Error('Serviço de banco exige IPC privado e arquivo explícito.')
let sqlite:Database.Database|null=null
const statements=new Map<string,Database.Statement>()
const cursors=new Map<number,IterableIterator<unknown>>()
let nextCursor=0
type Request={id:number;op:string;sql?:string;args?:unknown[];raw?:boolean;pluck?:boolean;safeIntegers?:boolean;cursor?:number;target?:string;options?:Record<string,unknown>}
const statement=(request:Request)=>{
  if(typeof request.sql!=='string'||!request.sql||request.sql.length>2*1024*1024)throw new Error('SQL inválido no contrato privado.')
  const key=JSON.stringify([request.sql,!!request.raw,!!request.pluck,!!request.safeIntegers])
  let value=statements.get(key)
  if(!value){
    value=sqlite!.prepare(request.sql)
    if(request.raw)value.raw()
    if(request.pluck)value.pluck()
    value.safeIntegers(!!request.safeIntegers)
    if(statements.size>=512)statements.delete(statements.keys().next().value!)
    statements.set(key,value)
  }
  return value
}
const close=()=>{
  for(const cursor of cursors.values())try{cursor.return?.()}catch{}
  cursors.clear();statements.clear()
  if(sqlite?.open)sqlite.close()
}
process.on('disconnect',()=>{try{close()}finally{process.exit(0)}})
process.on('SIGTERM',()=>{try{close()}finally{process.exit(0)}})
process.on('message',(value:unknown)=>{
  const request=value as Request
  if(!request||!Number.isSafeInteger(request.id)||typeof request.op!=='string')return
  void (async()=>{
    try{
      let result:unknown
      if(request.op==='open'){
        if(sqlite)throw new Error('Conexão já inicializada; reabertura automática recusada.')
        sqlite=new Database(file);result={name:sqlite.name,readonly:sqlite.readonly,memory:sqlite.memory,pid:process.pid}
      }else{
        if(!sqlite?.open)throw new Error('Conexão do serviço encerrada.')
        switch(request.op){
          case 'prepare':{const stmt=statement(request);result={reader:stmt.reader,readonly:stmt.readonly};break}
          case 'run':result=statement(request).run(...(request.args??[]));break
          case 'get':result=statement(request).get(...(request.args??[]));break
          case 'all':result=statement(request).all(...(request.args??[]));break
          case 'columns':result=statement(request).columns();break
          case 'exec':sqlite.exec(request.sql!);result=null;break
          case 'pragma':result=sqlite.pragma(request.sql!,request.options as {simple?:boolean}|undefined);break
          case 'iterateStart':{
            if(cursors.size>=64||nextCursor>=Number.MAX_SAFE_INTEGER)throw new Error('Limite de cursores privados atingido; encerre leituras anteriores.')
            const id=++nextCursor;cursors.set(id,statement(request).iterate(...(request.args??[])));result=id;break
          }
          case 'iterateNext':{
            const cursor=cursors.get(request.cursor!);if(!cursor)throw new Error('Cursor de leitura encerrado.')
            const rows:unknown[]=[];let done=false
            for(let n=0;n<64;n++){const next=cursor.next();if(next.done){done=true;break}rows.push(next.value)}
            if(done)cursors.delete(request.cursor!)
            result={rows,done};break
          }
          case 'iterateClose':cursors.get(request.cursor!)?.return?.();cursors.delete(request.cursor!);result=null;break
          case 'backup':
            if(!request.target||request.options&&Object.keys(request.options).length)throw new Error('Backup remoto exige destino sem callbacks locais.')
            result=await sqlite.backup(request.target);break
          case 'close':close();result=null;break
          default:throw new Error('Operação não suportada no contrato de banco.')
        }
      }
      process.send?.({id:request.id,ok:true,value:result,inTransaction:sqlite?.inTransaction??false})
    }catch(error){
      const failure=error as Error&{code?:string}
      process.send?.({id:request.id,ok:false,error:{name:failure.name,message:failure.message,code:failure.code},inTransaction:sqlite?.inTransaction??false})
    }
  })()
})
