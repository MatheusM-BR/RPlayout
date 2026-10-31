import dgram from 'node:dgram'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {healthEvents} from '../db/schema.js'
import {ClockMonitor,buildSntpRequest,clockConfigFromEnv,fromNtpTimestamp,measureServer,parseServer,sntpQuery,toNtpTimestamp,type ClockConfig,type SntpQuery} from './clock-monitor.js'
import {parseChronyTracking,parseScState,parseTimedatectl,parseW32tmStatus,readPlatformClock,type ExecFn} from './clock-platform.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIA_ROOT:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:''}))

/** Servidor SNTP falso em UDP local. */
interface Fake {skewMs:number|number[];holdMs:number;stratum:number;rootDispersion:number;leap:number;kiss:boolean;badOrigin:boolean;silent:boolean;mode:number}
async function fakeServer(overrides:Partial<Fake>={}){
  const state:Fake={skewMs:0,holdMs:0,stratum:2,rootDispersion:0.01,leap:0,kiss:false,badOrigin:false,silent:false,mode:4,...overrides}
  let requests=0
  const socket=dgram.createSocket('udp4')
  socket.on('message',(message,remote)=>{
    const n=requests++
    if(state.silent)return
    const skew=Array.isArray(state.skewMs)?state.skewMs[n%state.skewMs.length]!:state.skewMs
    const t1=Date.now()+skew
    const reply=()=>{
      const out=Buffer.alloc(48)
      out[0]=(state.leap<<6)|(4<<3)|state.mode
      out[1]=state.kiss?0:state.stratum
      out.writeUInt32BE(Math.round(state.rootDispersion*65536),8)
      if(state.kiss)out.write('DENY',12,'ascii')
      const origin=Buffer.from(message.subarray(40,48))
      if(state.badOrigin)origin[7]=origin[7]!^0xff
      origin.copy(out,24)
      toNtpTimestamp(t1,false).copy(out,32)
      toNtpTimestamp(Date.now()+skew,false).copy(out,40)
      socket.send(out,remote.port,remote.address)
    }
    state.holdMs?setTimeout(reply,state.holdMs):reply()
  })
  await new Promise<void>(resolve=>socket.bind(0,'127.0.0.1',resolve))
  return {spec:`127.0.0.1:${socket.address().port}`,state,close:()=>new Promise<void>(resolve=>socket.close(()=>resolve()))}
}
const opts=(now=Date.now)=>({timeoutMs:400,maxRootDispersionMs:500,now})
const cfg=(over:Partial<ClockConfig>={}):ClockConfig=>({...clockConfigFromEnv({}),timeoutMs:300,...over})

describe('SNTP (servidor UDP falso)',()=>{
  const servers:Array<{close:()=>Promise<void>}>=[]
  afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>s.close()))})
  const start=async(over:Partial<Fake>={})=>{const s=await fakeServer(over);servers.push(s);return s}

  it('timestamps NTP ida e volta',()=>{
    const ms=1_761_825_600_123.456
    expect(Math.abs(fromNtpTimestamp(toNtpTimestamp(ms,false),0)-ms)).toBeLessThan(0.001)
    const request=buildSntpRequest(ms)
    expect(request.packet[0]).toBe(0x23) // LI=0 VN=4 Mode=3
    expect(request.packet.subarray(40,48).equals(request.transmit)).toBe(true)
    expect(parseServer('a.st1.ntp.br')).toEqual({host:'a.st1.ntp.br',port:123})
    expect(parseServer('127.0.0.1:5123')).toEqual({host:'127.0.0.1',port:5123})
  })

  it('calcula offset ((t1-t0)+(t2-t3))/2 e RTT sem contar o tempo de processamento do servidor',async()=>{
    const s=await start({skewMs:250,holdMs:80})
    const sample=await sntpQuery(s.spec,opts())
    expect(Math.abs(sample.offsetMs-250)).toBeLessThan(10) // a espera do servidor (t2-t1) é simétrica na fórmula e sai do offset
    expect(sample.rttMs).toBeLessThan(30) // (t3-t0)-(t2-t1): os 80 ms de espera do servidor saem do RTT
    expect(sample.stratum).toBe(2)
    const behind=await start({skewMs:-1200})
    expect(Math.abs((await sntpQuery(behind.spec,opts())).offsetMs+1200)).toBeLessThan(20)
  })

  it('offset e RTT com relógios injetados (aritmética exata)',async()=>{
    const s=await start({skewMs:0})
    const now=Date.now()
    // cliente "100 ms atrasado": t0 e t3 reportados 100 ms antes do relógio real do servidor.
    let calls=0
    const sample=await sntpQuery(s.spec,{...opts(),now:()=>(calls++===0?now:now+20)-100})
    // t1,t2 ~ now+ε ; t0=now-100 ; t3=now-80 -> offset ≈ ((100)+(80))/2 = 90 ; rtt ≈ 20
    expect(sample.offsetMs).toBeGreaterThan(85);expect(sample.offsetMs).toBeLessThan(100)
    expect(sample.rttMs).toBeGreaterThan(18);expect(sample.rttMs).toBeLessThan(30)
  })

  it.each([
    ['stratum 16',{stratum:16}],
    ['kiss-of-death (stratum 0)',{kiss:true}],
    ['origin timestamp diferente',{badOrigin:true}],
    ['root dispersion alta',{rootDispersion:2}],
    ['LI=3 não sincronizado',{leap:3}],
    ['modo de servidor errado',{mode:3}],
    ['silêncio',{silent:true}],
  ] as Array<[string,Partial<Fake>]>)('descarta resposta inválida: %s',async(_name,over)=>{
    const s=await start(over)
    await expect(sntpQuery(s.spec,{...opts(),timeoutMs:200})).rejects.toThrow()
    const result=await measureServer(s.spec,cfg({timeoutMs:150}),sntpQuery,Date.now,new Set(),()=>false)
    expect(result).toMatchObject({ok:false,offsetMs:null})
  })

  it('mediana de 3 amostras: um outlier não contamina',async()=>{
    const s=await start({skewMs:[100,5000,120]})
    const result=await measureServer(s.spec,cfg(),sntpQuery,Date.now,new Set(),()=>false)
    expect(result.ok).toBe(true);expect(result.valid).toBe(3)
    expect(result.offsetMs!).toBeGreaterThan(95);expect(result.offsetMs!).toBeLessThan(130)
  })

  it('exige 3 amostras válidas: servidor que só entrega 2 é descartado',async()=>{
    let n=0
    const query:SntpQuery=async()=>{if(n++%3===2)throw new Error('timeout');return {offsetMs:1,rttMs:1,stratum:2}}
    // 1,2 válidas, 3 falha (timeout único), 4 válida -> chega a 3 com tentativa extra
    expect((await measureServer('x',cfg(),query,Date.now,new Set(),()=>false)).ok).toBe(true)
    const always:SntpQuery=async()=>{throw new Error('timeout')}
    const bad=await measureServer('x',cfg(),always,Date.now,new Set(),()=>false)
    expect(bad).toMatchObject({ok:false,valid:0})
  })
})

describe('configuração por ambiente',()=>{
  it('padrões e valores inválidos',()=>{
    const d=clockConfigFromEnv({})
    expect(d).toMatchObject({servers:['a.st1.ntp.br','b.st1.ntp.br','c.st1.ntp.br','pool.ntp.org'],intervalMs:600000,initialDelayMs:20000,warnMs:50,criticalMs:500,unverifiedRounds:3,jumpMs:1000,samples:3})
    expect(clockConfigFromEnv({RPLAYOUT_CLOCK_SERVERS:' x.org , y.org:124 ',RPLAYOUT_CLOCK_WARN_MS:'20',RPLAYOUT_CLOCK_CRITICAL_MS:'200'})).toMatchObject({servers:['x.org','y.org:124'],warnMs:20,criticalMs:200})
    expect(clockConfigFromEnv({RPLAYOUT_CLOCK_WARN_MS:'900',RPLAYOUT_CLOCK_CRITICAL_MS:'100',RPLAYOUT_CLOCK_INTERVAL_MS:'abc',RPLAYOUT_CLOCK_SAMPLES:'1'})).toMatchObject({warnMs:50,criticalMs:500,intervalMs:600000,samples:3})
  })
})

describe('monitor: estados e incidentes',()=>{
  let app:App,wall:number,mono:number,answers:Record<string,number|null>,emit:ReturnType<typeof vi.fn>,monitor:ClockMonitor
  const exec:ExecFn=async()=>{throw new Error('indisponível')}
  const query:SntpQuery=async server=>{const offset=answers[server];if(offset===null||offset===undefined)throw new Error('timeout');return {offsetMs:offset,rttMs:4,stratum:2}}
  const make=()=>new ClockMonitor(app.db,{servers:['s1','s2','s3']},{query,now:()=>wall,mono:()=>mono,exec,emit:emit as never})
  const advance=(ms:number)=>{wall+=ms;mono+=ms}
  const rows=()=>app.db.select().from(healthEvents).all().filter(row=>row.component==='CLOCK').sort((a,b)=>a.id.localeCompare(b.id))
  const set=(offset:number|null)=>{answers={s1:offset,s2:offset,s3:offset}}
  beforeEach(async()=>{
    app=await createApp(':memory:');wall=Date.parse('2026-10-30T12:00:00.000Z');mono=1_000_000;emit=vi.fn(async()=>{});set(0);monitor=make()
  })
  afterEach(async()=>{monitor.close();await app.close()})

  it('OK -> AVISO -> CRÍTICO -> recuperado, com um incidente por ocorrência',async()=>{
    advance(600_000);set(3);let status=await monitor.round()
    expect(status).toMatchObject({state:'OK',offsetMs:3});expect(rows()).toHaveLength(0);expect(emit).not.toHaveBeenCalled()

    advance(600_000);set(120);status=await monitor.round()
    expect(status.state).toBe('WARN')
    expect(rows().map(r=>[r.id.replace(/clock:drift:[^:]+:/,''),r.severity,r.resolvedAt])).toEqual([['active','WARN',null]])
    expect(rows()[0]).toMatchObject({component:'CLOCK',channelId:null,state:'warn'})
    expect(emit).toHaveBeenLastCalledWith(app.db,'clock.drift',expect.objectContaining({severity:'WARN',offsetMs:120}),null)

    advance(600_000);set(-900);status=await monitor.round()
    expect(status.state).toBe('CRITICAL')
    expect(rows().map(r=>r.id.replace(/clock:drift:[^:]+:/,'')).sort()).toEqual(['active','critical'])
    expect(emit).toHaveBeenCalledTimes(2);expect(emit).toHaveBeenLastCalledWith(app.db,'clock.drift',expect.objectContaining({severity:'CRITICAL'}),null)

    advance(600_000);set(900);await monitor.round() // continua crítico: sem novos eventos
    expect(rows()).toHaveLength(2);expect(emit).toHaveBeenCalledTimes(2)

    advance(600_000);set(2);status=await monitor.round()
    expect(status.state).toBe('OK')
    const all=rows()
    expect(all.map(r=>r.id.replace(/clock:drift:[^:]+:/,'')).sort()).toEqual(['active','critical','recovered'])
    expect(all.find(r=>r.id.endsWith(':recovered'))).toMatchObject({severity:'INFO',state:'recovered'})
    expect(all.filter(r=>!r.id.endsWith(':recovered')).every(r=>r.resolvedAt!==null)).toBe(true)
    expect(emit).toHaveBeenLastCalledWith(app.db,'clock.recovered',expect.objectContaining({severity:'INFO'}),null)

    advance(600_000);set(300);await monitor.round() // nova ocorrência: id novo, sem colidir
    expect(rows().filter(r=>r.id.endsWith(':active'))).toHaveLength(2)
  })

  it('mediana entre servidores: um servidor errado não abre incidente',async()=>{
    answers={s1:2,s2:4,s3:9000}
    const status=await monitor.round()
    expect(status.state).toBe('OK');expect(status.offsetMs).toBe(4)
    expect(status.servers.map(s=>s.ok)).toEqual([true,true,true]);expect(rows()).toHaveLength(0)
  })

  it('UNVERIFIED só como AVISO após 3 rodadas sem nenhuma resposta; volta a OK com resposta',async()=>{
    set(null)
    for(let i=1;i<=2;i++){advance(600_000);const s=await monitor.round();expect(s.consecutiveFailedRounds).toBe(i);expect(rows()).toHaveLength(0)}
    advance(600_000);const status=await monitor.round()
    expect(status.state).toBe('UNVERIFIED');expect(status.reason).toContain('UDP 123')
    expect(rows()).toHaveLength(1);expect(rows()[0]).toMatchObject({severity:'WARN',state:'unverified'});expect(emit).toHaveBeenCalledWith(app.db,'clock.drift',expect.anything(),null)
    advance(600_000);await monitor.round() // continua sem resposta: não duplica
    expect(rows()).toHaveLength(1)
    advance(600_000);set(1);expect((await monitor.round()).state).toBe('OK')
    expect(rows().map(r=>r.id.replace(/clock:drift:[^:]+:/,'')).sort()).toEqual(['active','recovered'])
    expect(emit).toHaveBeenLastCalledWith(app.db,'clock.recovered',expect.anything(),null)
  })

  it('falha de 1 ou 2 rodadas depois de medida boa não muda o estado',async()=>{
    set(5);await monitor.round();set(null);advance(600_000)
    expect((await monitor.round()).state).toBe('OK')
  })

  it('salto do relógio (parede x monotônico) vira AVISO imediato e é resolvido por medida nova',async()=>{
    set(2);await monitor.round()
    wall+=5_000;mono+=5_000 // passagem normal de tempo
    expect(monitor.checkJump()).toBe(false)
    wall+=3_700_000;mono+=5_000 // relógio local saltou ~1 h para frente
    expect(monitor.checkJump()).toBe(true)
    let status=monitor.status()
    expect(status.state).toBe('WARN');expect(status.reason).toContain('saltou');expect(status.jump?.jumpMs).toBeGreaterThan(3_000_000)
    expect(rows()).toHaveLength(1);expect(rows()[0]).toMatchObject({severity:'WARN',state:'jump'})
    expect(emit).toHaveBeenCalledTimes(1)
    wall+=5_000;mono+=5_000;monitor.checkJump();expect(emit).toHaveBeenCalledTimes(1) // não repete
    set(1);advance(600_000);status=await monitor.round()
    expect(status).toMatchObject({state:'OK',jump:null})
    expect(rows().some(r=>r.id.endsWith(':recovered'))).toBe(true)
  })

  it('salto para trás também é detectado; atraso de timer não é salto',()=>{
    advance(120_000);expect(monitor.checkJump()).toBe(false) // timer atrasado: parede e monotônico andam juntos
    wall-=2_000;mono+=1_000;expect(monitor.checkJump()).toBe(true)
  })

  it('reinício com incidente aberto: retoma e resolve em vez de duplicar',async()=>{
    set(300);await monitor.round();expect(rows()).toHaveLength(1)
    monitor.close()
    monitor=make();advance(600_000);set(1);await monitor.round()
    expect(rows().filter(r=>r.id.endsWith(':active'))).toHaveLength(1)
    expect(rows().find(r=>r.id.endsWith(':active'))!.resolvedAt).not.toBeNull()
    expect(rows().some(r=>r.id.endsWith(':recovered'))).toBe(true)
  })

  it('CLOCK nunca entra no escalonamento do PGM',async()=>{
    const {escalationTier}=await import('@rplayout/protocol')
    set(9000);await monitor.round()
    const row=rows().find(r=>r.id.endsWith(':critical'))!
    expect(escalationTier(row.component,row.state,row.severity,Date.parse(row.occurredAt)-3_600_000,Date.now())).toBeNull()
  })

  it('falha na gravação não derruba a rodada',async()=>{
    app.sqlite.exec("CREATE TRIGGER deny_clock BEFORE INSERT ON health_events WHEN NEW.component='CLOCK' BEGIN SELECT RAISE(ABORT,'fixture'); END")
    set(900)
    await expect(monitor.round()).resolves.toMatchObject({state:'CRITICAL'})
  })
})

describe('plataforma (informação complementar)',()=>{
  it('parsers',()=>{
    expect(parseW32tmStatus('Leap Indicator: 0\r\nSource: time.windows.com,0x9\r\nLast Successful Sync Time: 30/10/2026 11:00:00\r\n')).toEqual({source:'time.windows.com,0x9',lastSuccessfulSync:'30/10/2026 11:00:00'})
    expect(parseW32tmStatus('Origem: a.st1.ntp.br\nHora da Última Sincronização Bem-sucedida: 30/10/2026 11:00:00')).toEqual({source:'a.st1.ntp.br',lastSuccessfulSync:'30/10/2026 11:00:00'})
    expect(parseScState('SERVICE_NAME: w32time\n        STATE              : 1  STOPPED')).toBe(false)
    expect(parseScState('        STATE              : 4  RUNNING')).toBe(true)
    expect(parseTimedatectl('NTPSynchronized=yes\nNTP=yes\n')).toEqual({synchronized:true,ntpEnabled:true})
    expect(parseChronyTracking('Stratum         : 3\nSystem time     : 0.000012 seconds slow of NTP time\nLeap status     : Normal\n')).toEqual({stratum:3,systemTimeSeconds:-0.000012,leapStatus:'Normal'})
  })
  it('win32: W32Time parado é informado, não lança',async()=>{
    const exec:ExecFn=async file=>{
      if(file==='sc.exe')return {stdout:'        STATE              : 1  STOPPED',stderr:''}
      throw Object.assign(new Error('falhou'),{stdout:'',stderr:'0x80070426 (O serviço não foi iniciado.)'})
    }
    const platform=await readPlatformClock({exec,platform:'win32'})
    expect(platform).toMatchObject({platform:'win32',serviceRunning:false,source:null});expect(platform.error).toContain('W32Time')
  })
  it('win32 rodando e linux com chrony; falha de leitura vira erro e nunca exceção',async()=>{
    const win=await readPlatformClock({platform:'win32',exec:async file=>file==='sc.exe'?{stdout:'STATE : 4  RUNNING',stderr:''}:{stdout:'Source: pool\nLast Successful Sync Time: 1',stderr:''}})
    expect(win).toMatchObject({serviceRunning:true,source:'pool',lastSuccessfulSync:'1',error:null})
    const lin=await readPlatformClock({platform:'linux',exec:async file=>file==='timedatectl'?{stdout:'NTPSynchronized=no\nNTP=yes',stderr:''}:{stdout:'Stratum : 2\nLeap status : Normal',stderr:''}})
    expect(lin).toMatchObject({synchronized:false,ntpEnabled:true,chrony:{stratum:2}})
    const broken=await readPlatformClock({platform:'linux',exec:async()=>{throw new Error('ENOENT')}})
    expect(broken.error).toBe('ENOENT');expect(await readPlatformClock({platform:'darwin'})).toMatchObject({error:null})
  })
})
