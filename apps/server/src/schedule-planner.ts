import {planScheduleDay,type DayPlanRequest} from './domain/schedule-day.js'
// This helper has no DB, vault or engine access. Parent EOF kills unfinished
// selection; only the live owning server can validate and commit its result.
let input='',started=false
process.stdin.setEncoding('utf8')
process.stdin.on('end',()=>process.exit(2))
process.stdin.on('data',chunk=>{
  if(started)return
  input+=chunk
  if(input.length>16*1024*1024)process.exit(3)
  const newline=input.indexOf('\n');if(newline<0)return
  started=true
  try{
    const result=planScheduleDay(JSON.parse(input.slice(0,newline)) as DayPlanRequest)
    process.stdout.write(JSON.stringify({ok:true,result}),()=>process.exit(0))
  }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:'Montagem inválida.'}),()=>process.exit(0))}
})
