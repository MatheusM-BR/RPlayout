import { cpus, freemem, totalmem, platform } from 'node:os'
import { statfs, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { installationVault } from './secret-vault.js'
import type {OperationalMetricFrame} from './operational-metrics.js'
import {persistMetricHistory} from './metric-history-store.js'
const run = promisify(execFile)
type CpuCounters = { idle: number; total: number }
export function cpuUtilization(previous: CpuCounters | null, current: CpuCounters): number | null {
  if (!previous || current.total <= previous.total || current.idle < previous.idle) return null
  return Math.max(0, Math.min(100, Math.round((1-(current.idle-previous.idle)/(current.total-previous.total))*1000)/10))
}
export interface HostMetricSample {
  operations?:OperationalMetricFrame
  generatedAt: string; sampleIntervalSeconds: number
  cpu: { percent: number | null; cores: number }
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; percent: number | null }
  process: { rssBytes: number; heapUsedBytes: number }
  gpu: { utilizationPercent: number | null; memoryUsedMiB: number | null; memoryTotalMiB: number | null; temperatureC: number | null; name: string | null; error: string | null }
  disk: { path: string; totalBytes: number | null; freeBytes: number | null; percentUsed: number | null; error: string | null }
  network: { receivedBytesPerSecond: number | null; sentBytesPerSecond: number | null; source: string | null; error: string | null }
}

type HostConditionKey = 'CPU' | 'RAM' | 'DISK' | 'DISK_ERROR'
const HOST_RULES: Record<HostConditionKey, { open: number; close: number; openAfter: number; closeAfter: number }> = {
  // CPU oscila muito: exige 20 s acima de 90% para abrir e 30 s abaixo de 85% para fechar.
  CPU: { open: 90, close: 85, openAfter: 2, closeAfter: 3 },
  RAM: { open: 90, close: 85, openAfter: 2, closeAfter: 3 },
  DISK: { open: 90, close: 88, openAfter: 1, closeAfter: 3 },
  DISK_ERROR: { open: 0, close: 0, openAfter: 1, closeAfter: 2 },
}
const pct = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString('pt-BR')}%`
const gb = (bytes: number | null) => bytes === null ? 'N/D' : `${(bytes / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
export interface HostIncidentChange { kind: 'open' | 'close'; key: HostConditionKey; id: string; message: string }
/** Estado das condições do host entre amostras. Puro: o banco só recebe as mudanças. */
export class HostIncidentTracker {
  private readonly open = new Map<HostConditionKey, { id: string; since: number }>()
  private readonly above = new Map<HostConditionKey, number>()
  private readonly below = new Map<HostConditionKey, number>()
  private adopted = false
  /** Depois de reiniciar o servidor, continua o incidente aberto em vez de abrir outro. */
  adopt(sqlite: Database.Database): void {
    if (this.adopted) return
    this.adopted = true
    try {
      const rows = sqlite.prepare("SELECT id, occurred_at FROM health_events WHERE component='HOST' AND state='degraded' AND id LIKE 'host:%' AND resolved_at IS NULL").all() as Array<{ id: string; occurred_at: string }>
      for (const row of rows) {
        const key = row.id.split(':')[1] as HostConditionKey
        if (key in HOST_RULES && !this.open.has(key)) this.open.set(key, { id: row.id, since: Date.parse(row.occurred_at) || Date.now() })
      }
    } catch { /* banco antigo sem resolved_at: começa limpo */ }
  }
  isOpen(key: HostConditionKey): boolean { return this.open.has(key) }
  evaluate(sample: Pick<HostMetricSample, 'cpu' | 'memory' | 'disk' | 'generatedAt'>): HostIncidentChange[] {
    const now = Date.parse(sample.generatedAt) || Date.now()
    const readings: Record<HostConditionKey, { value: number | null; text: () => string; recovered: () => string }> = {
      CPU: { value: sample.cpu.percent, text: () => `CPU acima de 90% (${pct(sample.cpu.percent!)})`, recovered: () => `CPU normalizada (${pct(sample.cpu.percent!)})` },
      RAM: { value: sample.memory.percent, text: () => `RAM acima de 90% (${pct(sample.memory.percent!)}; ${gb(sample.memory.freeBytes)} livres)`, recovered: () => `RAM normalizada (${pct(sample.memory.percent!)})` },
      DISK: { value: sample.disk.percentUsed, text: () => `Volume do acervo acima de 90% (${pct(sample.disk.percentUsed!)} usado; ${gb(sample.disk.freeBytes)} livres em ${sample.disk.path})`, recovered: () => `Volume do acervo normalizado (${pct(sample.disk.percentUsed!)} usado; ${gb(sample.disk.freeBytes)} livres)` },
      DISK_ERROR: { value: sample.disk.error ? 1 : 0, text: () => sample.disk.error ?? 'Volume do acervo inacessível.', recovered: () => 'Volume do acervo acessível novamente.' },
    }
    const changes: HostIncidentChange[] = []
    for (const key of Object.keys(HOST_RULES) as HostConditionKey[]) {
      const rule = HOST_RULES[key], reading = readings[key]
      if (reading.value === null) continue // sem leitura não abre nem fecha
      const isAbove = reading.value > rule.open, isBelow = key === 'DISK_ERROR' ? reading.value === 0 : reading.value < rule.close
      this.above.set(key, isAbove ? (this.above.get(key) ?? 0) + 1 : 0)
      this.below.set(key, isBelow ? (this.below.get(key) ?? 0) + 1 : 0)
      const current = this.open.get(key)
      if (!current && (this.above.get(key) ?? 0) >= rule.openAfter) changes.push({ kind: 'open', key, id: `host:${key}:${randomUUID()}`, message: reading.text() })
      else if (current && (this.below.get(key) ?? 0) >= rule.closeAfter) {
        const minutes = Math.max(1, Math.round((now - current.since) / 60_000))
        changes.push({ kind: 'close', key, id: current.id, message: `${reading.recovered()} após ${minutes} min.` })
      }
    }
    return changes
  }
  /** Só depois de gravado: falha de gravação repete a mudança na próxima amostra. */
  commit(changes: HostIncidentChange[], at = Date.now()): void {
    for (const change of changes) {
      if (change.kind === 'open') this.open.set(change.key, { id: change.id, since: at })
      else this.open.delete(change.key)
    }
  }
}

/** A single collector per host, shared by all clients. Absent counters stay
 * null. It runs independently of browser attendance and persists its samples. */
export class HostMetrics {
  onCapture:(()=>Promise<OperationalMetricFrame>)|null=null
  onIncident: ((state: 'degraded' | 'running',message:string,sample:HostMetricSample) => void) | null = null
  private previousCpu: CpuCounters | null = null
  private previousNetwork: { received: number; sent: number; at: number } | null = null
  private cached: HostMetricSample | null = null
  private pending: Promise<HostMetricSample> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private readonly incidents = new HostIncidentTracker()
  constructor(private readonly sqlite: Database.Database, private readonly storagePath: string) {}
  start(): void {
    if (this.timer || this.closed) return
    void this.latest().catch(() => {})
    this.timer = setInterval(() => void this.latest().catch(() => {}), 10_000)
    this.timer.unref()
  }
  latest(): Promise<HostMetricSample> {
    if (this.cached && Date.now()-Date.parse(this.cached.generatedAt) < 9500) return Promise.resolve(this.cached)
    if (this.pending) return this.pending
    this.pending = this.collect().finally(() => { this.pending = null })
    return this.pending
  }
  history(since: string, limit = 2000): HostMetricSample[] {
    const {keys}=this.pageKeys('sampled_at>=?',[since],Math.max(1,Math.min(5000,limit)))
    if(!keys.length)return []
    return (this.sqlite.prepare('SELECT payload FROM host_metric_samples WHERE sampled_at>=? AND sampled_at<=? ORDER BY sampled_at DESC').all(keys.at(-1),keys[0]) as Array<{ payload: string }>).map(row => JSON.parse(row.payload))
  }
  /** Newest-first sample keys whose payloads fit one storage reply. Samples
   * grow with process/output count; 5 000 of them reached ~14 MB, close to
   * the 16 MiB reply limit that stopped the server once. */
  private pageKeys(where:string,args:unknown[],size:number,budgetBytes=4*2**20):{keys:string[];more:boolean}{
    const rows=this.sqlite.prepare(`SELECT sampled_at, length(payload) AS bytes FROM host_metric_samples WHERE ${where} ORDER BY sampled_at DESC LIMIT ?`).all(...args,size+1) as Array<{sampled_at:string;bytes:number}>
    const keys:string[]=[];let total=0
    for(const row of rows.slice(0,size)){if(keys.length&&total+row.bytes>budgetBytes)break;total+=row.bytes;keys.push(row.sampled_at)}
    return {keys,more:rows.length>keys.length}
  }
  historyCount(since: string): number {
    return (this.sqlite.prepare('SELECT COUNT(*) AS count FROM host_metric_samples WHERE sampled_at>=?').get(since) as { count: number }).count
  }
  historyPage(since:string,until:string,before:string|undefined,limit:number){
    const requested=Math.max(1,Math.min(5000,limit))
    const {keys,more}=this.pageKeys('sampled_at>=? AND sampled_at<=? AND sampled_at<?',[since,until,before??'9999'],requested)
    const size=keys.length
    const rows=size?this.sqlite.prepare('SELECT sampled_at,payload FROM host_metric_samples WHERE sampled_at>=? AND sampled_at<=? ORDER BY sampled_at DESC').all(keys[size-1],keys[0]) as Array<{sampled_at:string;payload:string}>:[]
    const selected=rows.slice(0,size)
    const totalSamples=(this.sqlite.prepare('SELECT COUNT(*) AS count FROM host_metric_samples WHERE sampled_at>=? AND sampled_at<=?').get(since,until) as {count:number}).count
    return {totalSamples,nextBefore:more&&selected.length?selected.at(-1)!.sampled_at:null,samples:selected.map(row=>({sampledAt:row.sampled_at,sample:JSON.parse(row.payload) as HostMetricSample}))}
  }
  private async collect(): Promise<HostMetricSample> {
    const cores = cpus()
    const cpu = cores.reduce((sum, core) => ({ idle: sum.idle+core.times.idle, total: sum.total+Object.values(core.times).reduce((a,b) => a+b,0) }), { idle: 0, total: 0 })
    const percent = cpuUtilization(this.previousCpu, cpu); this.previousCpu = cpu
    const total = totalmem(), free = freemem(), used = Math.max(0,total-free)
    const sample: HostMetricSample = {
      generatedAt: new Date().toISOString(), sampleIntervalSeconds: 10,
      cpu: { percent, cores: cores.length }, memory: { totalBytes: total, usedBytes: used, freeBytes: free, percent: total > 0 ? Math.round(used/total*1000)/10 : null },
      process: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed },
      gpu: { utilizationPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, temperatureC: null, name: null, error: null },
      disk: { path: this.storagePath, totalBytes: null, freeBytes: null, percentUsed: null, error: null },
      network: { receivedBytesPerSecond: null, sentBytesPerSecond: null, source: null, error: null },
    }
    await Promise.all([
      (async () => {
        try {
          const { stdout } = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu','--format=csv,noheader,nounits'], { timeout: 1500, windowsHide: true })
          const values = stdout.trim().split(/\r?\n/)[0]?.split(',').map(value => value.trim()) ?? []
          const number = (index: number) => values[index] && Number.isFinite(Number(values[index])) ? Number(values[index]) : null
          sample.gpu = { name: values[0] ?? null, utilizationPercent: number(1), memoryUsedMiB: number(2), memoryTotalMiB: number(3), temperatureC: number(4), error: null }
        } catch { sample.gpu.error = 'nvidia-smi indisponível; GPU não medida.' }
      })(),
      (async () => {
        try {
          const info = await statfs(this.storagePath)
          const size = info.blocks*info.bsize, available = info.bavail*info.bsize
          sample.disk = { path: this.storagePath, totalBytes: size, freeBytes: available, percentUsed: size > 0 ? Math.round((1-available/size)*1000)/10 : null, error: null }
        } catch { sample.disk.error = 'Volume do acervo inacessível ou sem contadores de espaço.' }
      })(),
      (async () => {
        try {
          let received = 0, sent = 0
          if (platform() === 'win32') {
            const { stdout } = await run('powershell.exe', ['-NoProfile','-NonInteractive','-Command', 'Get-NetAdapterStatistics | Select-Object ReceivedBytes,SentBytes | ConvertTo-Json -Compress'], { timeout: 2500, windowsHide: true })
            const value = JSON.parse(stdout), rows = Array.isArray(value) ? value : [value]
            if (!rows.length || !rows.every(row => Number.isFinite(row.ReceivedBytes) && Number.isFinite(row.SentBytes))) throw new Error('Contadores inválidos')
            for (const row of rows) { received += row.ReceivedBytes; sent += row.SentBytes }
            sample.network.source = 'Get-NetAdapterStatistics (soma dos adaptadores)'
          } else if (platform() === 'linux') {
            for (const line of (await readFile('/proc/net/dev','utf8')).split('\n')) {
              if (!line.includes(':') || line.trim().startsWith('lo:')) continue
              const values = line.split(':')[1]!.trim().split(/\s+/).map(Number)
              received += values[0] ?? 0; sent += values[8] ?? 0
            }
            sample.network.source = '/proc/net/dev (sem loopback)'
          } else throw new Error('Coletor de rede não disponível neste sistema')
          const now = performance.now(), previous = this.previousNetwork
          if (previous && now > previous.at && received >= previous.received && sent >= previous.sent) {
            sample.network.receivedBytesPerSecond = Math.round((received-previous.received)*1000/(now-previous.at))
            sample.network.sentBytesPerSecond = Math.round((sent-previous.sent)*1000/(now-previous.at))
          }
          this.previousNetwork = { received, sent, at: now }
        } catch { sample.network.error = 'Contadores de rede indisponíveis; tráfego não estimado.' }
      })(),
    ])
    if(this.onCapture&&!this.closed){
      try{sample.operations=await this.onCapture()}catch{sample.operations={version:1,capturedAt:new Date().toISOString(),available:false,channelsTruncated:false,channels:[]}}
    }
    if (!this.closed) {
      // Histerese e deduplicação: um incidente por condição (CPU, RAM, disco),
      // aberto depois de amostras seguidas acima do limite e fechado quando
      // normaliza abaixo de um limite menor. Mudança de texto não abre outro.
      this.incidents.adopt(this.sqlite)
      const changes=this.incidents.evaluate(sample)
      persistMetricHistory(this.sqlite,sample,Date.now(),()=>{
        for(const change of changes){
          const message=installationVault().encrypt(change.message,'health_events.message')
          if(change.kind==='open')this.sqlite.prepare('INSERT INTO health_events (id,component,state,severity,message,occurred_at) VALUES (?,?,?,?,?,?)').run(change.id,'HOST','degraded','WARN',message,sample.generatedAt)
          else {
            this.sqlite.prepare('UPDATE health_events SET resolved_at=? WHERE id=? AND resolved_at IS NULL').run(sample.generatedAt,change.id)
            this.sqlite.prepare('INSERT OR IGNORE INTO health_events (id,component,state,severity,message,occurred_at) VALUES (?,?,?,?,?,?)').run(change.id+':recovered','HOST','recovered','INFO',message,sample.generatedAt)
          }
        }
      })
      this.incidents.commit(changes)
      this.cached=sample
      for(const change of changes)this.onIncident?.(change.kind==='open'?'degraded':'running',change.message,sample)
    }
    return sample
  }
  close(): void { this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = null }
}
