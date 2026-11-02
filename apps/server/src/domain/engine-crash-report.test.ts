import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,describe,expect,it} from 'vitest'
import {StderrTail,describeEngineExit,writeEngineCrashReport} from './engine-crash-report.js'
const dirs:string[]=[]
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
describe('relatório de encerramento do engine',()=>{
  it('dá nome ao código do Windows visto na instalação (0xC0000409)',()=>{
    expect(describeEngineExit(3221226505,null)).toContain('0xC0000409')
    expect(describeEngineExit(3221226505,null)).toContain('panic')
    expect(describeEngineExit(-1073740791,null)).toContain('0xC0000409')
    expect(describeEngineExit(101,null)).toBe('código 101')
    expect(describeEngineExit(null,'SIGKILL')).toBe('sinal SIGKILL')
  })
  it('guarda só as últimas linhas e grava o relatório sem sobrescrever',()=>{
    const tail=new StderrTail(3);for(const line of ['a','b','c',"thread '<unnamed>' panicked at src/channel.rs:10:5"])tail.push(line)
    expect(tail.snapshot()).toEqual(['b','c',"thread '<unnamed>' panicked at src/channel.rs:10:5"])
    const dir=mkdtempSync(join(tmpdir(),'crash-'));dirs.push(dir)
    const crash={channelId:'ch/1',channelName:'RW',code:3221226505,signal:null,pid:42,startedAt:1000,at:61000,stderr:tail.snapshot(),memory:{freeBytes:2**30,totalBytes:2**34}}
    const file=writeEngineCrashReport(join(dir,'logs'),crash)!
    const text=readFileSync(file,'utf8')
    expect(text).toContain('0xC0000409');expect(text).toContain('panicked at src/channel.rs:10:5');expect(text).toContain('tempo no ar: 60 s');expect(text).toContain('1024 MiB livres')
    expect(writeEngineCrashReport(join(dir,'logs'),crash)).toBeNull()
    expect(readdirSync(join(dir,'logs'))).toHaveLength(1)
  })
})
