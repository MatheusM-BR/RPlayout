import { spawn,type ChildProcess } from 'node:child_process'
import {IngestOwnership} from './ingest-ownership.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { constants, setPriority } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { hasVideoFileSuffix, type AudioTrack } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import type Database from 'better-sqlite3'
import type { MediaWorkflow } from './media-workflow.js'
import { mediaAssets } from '../db/schema.js'
import { mediaProcessEnvironment } from './media-process-environment.js'

/** O que a sonda devolve. Uma linha de JSON, sucesso ou motivo da falha. */
type ProbeResult =
  | {
      ok: true
      durationNs: number
      videoCodec?: string
      video?: {
        width: number
        height: number
        rateNum: number
        rateDen: number
        interlaceMode: string
      }
      audio?: {
        rate: number
        channels: number
        /** Ausente quando a sonda não mediu. */
        integratedLufs?: number
        lra?: number
        truePeakDbtp?: number
      }
      /** Todas as trilhas, na ordem em que o arquivo as declara. */
      audioTracks?: AudioTrack[]
      thumbnail?: string
    }
  | { ok: false; reason: string }

export interface IngestStatus {
  readonly running: boolean
  /** Pasta sendo varrida agora, das que entraram nesta varredura. */
  readonly root: string | null
  /** Todas as pastas desta varredura. */
  readonly roots: readonly string[]
  /** Arquivo sendo lido agora, para a interface não parecer travada. */
  readonly current: string | null
  readonly seen: number
  readonly total: number
  readonly added: number
  readonly updated: number
  readonly skipped: number
  readonly failed: number
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly error: string | null
}

/**
 * Um arquivo recém-copiado pode estar pela metade. Só entra o que parou de
 * mudar: mais barato do que ingerir errado e ter que reconhecer isso depois.
 */
const SETTLE_MS = 5_000

/**
 * Quanto a varredura espera, no fim, pelos arquivos que ainda estavam mudando.
 *
 * Antes disto o arquivo novo era pulado e ficava "para a próxima varredura" --
 * só que a próxima varredura é alguém clicando de novo, e ninguém clica duas
 * vezes para achar um arquivo que está claramente na pasta. O resultado era
 * "mandei procurar e ele não achou", com a lista dizendo que tinha terminado.
 *
 * Agora eles voltam no fim da mesma varredura: uma cópia que acabou de sair
 * entra sozinha, e uma cópia que continua correndo é declarada, não engolida.
 */
const SETTLE_WAIT_MS = 45_000

/** Pastas que a varredura nunca desce. */
const SKIP = new Set(['.git', 'node_modules', '.thumbs'])

/**
 * Extensões que não são mídia e não entram no acervo.
 *
 * Lista de reprodução mora na mesma pasta dos vídeos, e a sonda não abre uma:
 * antes disto, cada `.m3u` virava um arquivo "não abriu" no explorador, ao
 * lado dos que de fato estão quebrados. Lista tem lugar próprio.
 */
const PLAYLIST_EXT = new Set(['.m3u', '.m3u8'])
const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini'])

/** Este arquivo é uma lista de reprodução? */
export function isPlaylist(path: string): boolean {
  return PLAYLIST_EXT.has(extname(path).toLowerCase())
}

/**
 * Ingest do acervo.
 *
 * Não existe lista de extensões, de propósito: quem decide se um arquivo abre é
 * o GStreamer, e a sonda usa o mesmo GStreamer que vai tocá-lo. Uma lista nossa
 * diria "sim" para arquivo que o pipeline recusa e "não" para arquivo que ele
 * tocaria sem reclamar.
 *
 * O que não abre não some: fica no acervo com o motivo à vista, porque é
 * justamente o caso em que alguém precisa fazer alguma coisa.
 */
/** Motivo de um arquivo que estava no acervo e não está mais na pasta. */
export const VANISHED = 'o arquivo não está mais na pasta'

export const SILENT_AUDIO_NOTE='Áudio em silêncio digital na medição: confira o arquivo antes de pôr no ar.'
/** Measured, present audio track that never rises above the BS.1770 absolute
 * gate with true peak under −60 dBTP. Unmeasured (null) says nothing. */
export function silentAudioNote(loudness:{integratedLufs:number;truePeakDbtp:number}|null):string|null{
  return loudness&&loudness.integratedLufs<=-69.95&&loudness.truePeakDbtp<=-60?SILENT_AUDIO_NOTE:null
}

export class Ingest {
  private state: IngestStatus = {
    running: false,
    root: null,
    roots: [],
    current: null,
    seen: 0,
    total: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
  }

  /**
   * Chamado quando a varredura termina.
   *
   * A grade guarda o acervo resolvido, então medição nova só chega até ela por
   * um recálculo -- sem isto, o nivelamento continuaria usando o número velho
   * até alguém mexer em qualquer outra coisa.
   */
  onFinished: (() => void) | null = null
  /**
   * Medir loudness na varredura.
   *
   * Ligado, o acervo já chega nivelável -- o modo automático tem de onde tirar
   * o ganho. Desligado, a leitura é muitas vezes mais rápida e o nivelamento
   * automático fica sem base até alguém medir.
   */
  measure = true
  private measuring = true
  private batchId: string | null = null
  private closed = false
  private active:Promise<void>|null=null
  private reconciliation:Promise<boolean>|null=null
  private readonly abort=new AbortController()
  private readonly probeAttempt=randomUUID()
  private readonly children=new Map<ChildProcess,Promise<void>>()
  private readonly ownership:IngestOwnership
  get isDraining(){return this.active!==null||this.reconciliation!==null||this.children.size>0}
  async settled():Promise<void>{await Promise.all([this.active,this.reconciliation]);await Promise.all(this.children.values())}
  close():Promise<void>{this.closed=true;this.abort.abort();for(const child of this.children.keys())child.kill();return this.settled()}
  private track(child:ChildProcess){
    const ended=new Promise<void>(done=>{let finished=false;const finish=()=>{if(finished)return;finished=true;this.children.delete(child);done()};child.once('close',finish);child.once('error',()=>{if(!child.pid)finish()})})
    this.children.set(child,ended)
  }

  constructor(
    private readonly db: Db,
    /** Binário da sonda. Vazio deixa o acervo como está. */
    private readonly probeBinary: string,
    /** Onde as miniaturas ficam. */
    private readonly thumbnailDir: string,
    private readonly workflow?: MediaWorkflow,
    private readonly sqlite?: Database.Database,
  ) {this.ownership=new IngestOwnership(sqlite??db.$client)}

  status(): IngestStatus {
    return this.state
  }

  get available(): boolean {
    return this.probeBinary !== ''
  }

  /**
   * Dispara a varredura e volta na hora. Ler um acervo inteiro leva minutos --
   * medir loudness custa decodificar o áudio de cada arquivo -- e segurar a
   * resposta HTTP por isso deixaria a interface pendurada.
   */
  start(roots: string | readonly string[], measure = this.measure, resumedBatchId?: string): boolean {
    if (this.closed || this.active || this.state.running || !this.available) return false
    const pastas = (typeof roots === 'string' ? [roots] : roots).map((entry) => resolve(entry))
    if (pastas.length === 0) return false
    const claimed=this.ownership.claim(pastas,measure,resumedBatchId)
    if(!claimed)return false
    this.measuring = measure
    this.batchId = claimed
    this.state = {
      running: true,
      root: pastas[0] ?? null,
      roots: pastas,
      current: null,
      seen: 0,
      total: 0,
      added: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    }
    this.active=this.run(pastas).finally(()=>{
      this.active=null
      if(!this.closed)queueMicrotask(()=>{if(this.closed)return;try{this.resumePending()}catch{this.patch({error:'Fila de varredura indisponível; lotes preservados.'})}})
    })
    return true
  }

  resumePending(): boolean {
    if(this.closed||this.state.running||!this.available)return false
    const batch = this.ownership.pending()
    if (!batch) return false
    return this.start(batch.roots,batch.measure,batch.id)
  }

  /** Confere também referências antigas que ficaram fora das raízes atuais. */
  reconcileAvailability():Promise<boolean>{
    if(this.closed||isRecoveryRehearsal(this.sqlite??this.db.$client))return Promise.resolve(false)
    return this.reconciliation??=this.reconcile().finally(()=>{this.reconciliation=null})
  }
  private async reconcile(): Promise<boolean> {
    let changed = false
    for (const row of await this.db.select().from(mediaAssets)) {
      if(this.closed)return changed
      if (row.path.includes('://')) continue
      try {
        if (!(await stat(row.path)).isFile()) throw new Error('não é arquivo')
      } catch {
        if(this.closed)return changed
        if (row.probeError === VANISHED) continue
        await this.db.update(mediaAssets).set({ probeError: VANISHED }).where(eq(mediaAssets.id, row.id))
        changed = true
      }
    }
    return changed
  }

  private patch(change: Partial<IngestStatus>): void {
    this.state = { ...this.state, ...change }
  }

  private async run(roots: readonly string[]): Promise<void> {
    try {
      // Anda por todas as pastas antes de absorver qualquer coisa: o total é o
      // que a interface mostra como progresso, e ele não pode crescer no meio.
      const files: string[] = []
      for (const root of roots) {
        if(this.closed)return
        this.patch({ root })
        // Procurar numa pasta de rede grande leva minutos, e até aqui a
        // interface mostrava "0/0" e mais nada: do lado de fora isso é uma
        // varredura que não termina. Agora ela diz onde está.
        files.push(
          ...(await walk(root, (dir, achados) =>
            this.patch({ current: `procurando em ${dir} (${achados} até agora)` }),
            (dir, error) => this.patch({ error: `Não foi possível ler ${dir}: ${error}` }),()=>this.closed,
          )),
        )
      }
      // A mesma pasta apontada duas vezes não faz o arquivo entrar duas vezes.
      const unicos = [...new Set(files)].sort()
      if (this.closed) return
      this.patch({ total: unicos.length })
      await mkdir(this.thumbnailDir, { recursive: true })

      const mudando: string[] = []
      for (const file of unicos) {
        if (this.closed) return
        this.patch({ current: file, seen: this.state.seen + 1 })
        if (!(await this.absorbSafely(file))) mudando.push(file)
      }
      await this.esperarOsQueMudavam(mudando)
      if (this.closed) return
      await this.markVanished(roots, unicos)
      await this.tirarListas()
      this.patch({ running: false, current: null, finishedAt: new Date().toISOString() })
      if(!this.closed)this.onFinished?.()
    } catch (failure) {
      this.patch({
        running: false,
        current: null,
        finishedAt: new Date().toISOString(),
        error: failure instanceof Error ? failure.message : 'A varredura falhou.',
      })
      // Mesmo tendo falhado no meio, o que já entrou tem que chegar à grade.
      if(!this.closed)this.onFinished?.()
    } finally {
      await Promise.all(this.children.values())
      // Storage can be gone here (process ended, console closed). Closing the
      // batch record must not throw out of a background scan: on 22/10 that
      // unhandled rejection ended the whole server, and the PGM with it. The
      // batch stays open and is resumed/reviewed on the next start.
      try{if(this.batchId)this.ownership.finish(this.batchId,this.closed,this.state.error)}
      catch{this.state={...this.state,error:this.state.error??'Lote não fechado: banco indisponível; será revisto na próxima partida.'}}
      this.patch({running:false,current:null,finishedAt:new Date().toISOString()})
      this.batchId = null
    }
  }

  /**
   * Volta nos arquivos que ainda estavam sendo copiados.
   *
   * Uma cópia grande pela rede continua correndo enquanto a varredura anda; o
   * arquivo é pulado na primeira passada de propósito, para não entrar pela
   * metade. Só que "fica para a próxima varredura" quer dizer "fica para
   * alguém clicar de novo", e ninguém clica duas vezes para achar um arquivo
   * que está claramente na pasta. Então a varredura espera aqui, no fim, com
   * hora para acabar: o que parou entra, e o que continua correndo é contado
   * como pulado -- declarado, não engolido.
   */
  private async esperarOsQueMudavam(arquivos: readonly string[]): Promise<void> {
    if (arquivos.length === 0) return
    const limite = Date.now() + SETTLE_WAIT_MS
    let pendentes = [...arquivos]

    while (!this.closed && pendentes.length > 0 && Date.now() < limite) {
      this.patch({ current: `${pendentes[0]} (esperando a cópia terminar)` })
      await new Promise<void>(pronto=>{if(this.closed){pronto();return}const finish=()=>{clearTimeout(timer);this.abort.signal.removeEventListener('abort',finish);pronto()};const timer=setTimeout(finish,2000);this.abort.signal.addEventListener('abort',finish,{once:true})})
      const restam: string[] = []
      for (const arquivo of pendentes) {
        if (!(await this.absorbSafely(arquivo))) restam.push(arquivo)
      }
      pendentes = restam
    }

    // Passou da hora e ainda mudam: entram na conta de pulados, com a última
    // chance marcada para o contador não ficar mentindo.
    for (const arquivo of pendentes) await this.absorbSafely(arquivo, true)
  }

  /**
   * Marca o que sumiu da pasta.
   *
   * Arquivo apagado continuava no acervo como se estivesse lá, e só ia dar
   * defeito na hora do ar. Sumir com a linha seria pior: a grade que aponta
   * para ele perderia a referência sem explicação. Ele fica, com o motivo à
   * vista, como qualquer arquivo que não abre.
   */
  private async markVanished(roots: readonly string[], seen: readonly string[]): Promise<void> {
    const present = new Set(seen)
    const rows = await this.db.select().from(mediaAssets)
    for (const row of rows) {
      if (this.closed) return
      // Só o que está sob alguma pasta varrida: acervo de pasta que ficou de
      // fora desta varredura não é assunto dela. Varrer uma pasta só e marcar
      // o resto do acervo como sumido seria apagar o que ninguém olhou.
      if (!roots.some((root) => dentroDe(root, row.path)) || present.has(row.path)) continue
      if (row.probeError === VANISHED) continue
      await this.db
        .update(mediaAssets)
        .set({ probeError: VANISHED })
        .where(eq(mediaAssets.id, row.id))
    }
  }

  /**
   * Tira do acervo as listas de reprodução que entraram antes de existir lugar
   * para elas.
   *
   * Sem isto, quem já varreu a pasta continuaria com um `.m3u` marcado como
   * "não abriu" para sempre -- e um arquivo quebrado que não dá para consertar
   * é pior que nenhum, porque some no meio dos que dão.
   */
  private async tirarListas(): Promise<void> {
    const linhas = await this.db.select().from(mediaAssets)
    for (const linha of linhas) {
      if (!isPlaylist(linha.path)) continue
      await this.db.delete(mediaAssets).where(eq(mediaAssets.id, linha.id))
    }
  }

  private async absorb(path: string, ultimaChance = false): Promise<boolean> {
    if (this.closed) return true
    const info = await stat(path)
    // Data no futuro é relógio fora de hora -- uma pasta de rede com o relógio
    // adiantado, por exemplo. Sem esta guarda o arquivo nunca "para de mudar"
    // e a varredura fica esperando por ele até o limite, toda vez.
    const idade = Date.now() - info.mtimeMs
    if (idade >= 0 && idade < SETTLE_MS) {
      // Ainda mudando. Volta no fim da varredura, quando tiver parado.
      if (!ultimaChance) return false
      this.patch({ skipped: this.state.skipped + 1 })
      return true
    }

    const modifiedAt = info.mtime.toISOString()
    const [observed] = await this.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.path, path))
      .limit(1)

    // Tamanho e data iguais: nada mudou, e reler para descobrir isso custaria
    // ler o acervo inteiro a cada varredura.
    //
    // Com uma exceção: quem pediu para medir e encontra arquivo sem medição
    // quer a medição. Sem isso, uma leitura rápida antes deixava o acervo
    // inteiro marcado como visto, e a leitura com medição depois pulava tudo
    // -- o nivelamento automático ficava sem base para sempre, e não havia
    // como descobrir por quê.
    const faltaMedir = this.measuring && observed?.hasAudio !== false && observed?.loudnessFile == null
    if (
      observed &&
      observed.sizeBytes === info.size &&
      observed.modifiedAt === modifiedAt &&
      !observed.probeError &&
      !faltaMedir
    ) {
      this.workflow?.record(observed.id, observed as unknown as Record<string, unknown>)
      this.patch({ skipped: this.state.skipped + 1 })
      return true
    }

    const contentHash = await hashFile(path,this.abort.signal)
    if(this.closed)return true
    const thumbnail = join(this.thumbnailDir, `${contentHash}-${this.probeAttempt}.jpg`)
    const probe = await this.probe(path, thumbnail)
    if (this.closed) return true
    const after = await stat(path)
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
      if (!ultimaChance) return false
      this.patch({ skipped: this.state.skipped + 1 })
      return true
    }

    // Hash/probe may take minutes. Never write operator decisions copied before
    // that await. Take the writer lock, reread the catalog and merge against the
    // current title/ignored/QC/loudness. The slow work stays outside the lock.
    const committed = this.db.transaction(
      () => this.commitProbe(path, observed?.id ?? null, { contentHash, sizeBytes: info.size, modifiedAt }, probe),
      { behavior: 'immediate' },
    )
    this.patch({ [committed.state]: this.state[committed.state] + 1 })
    // Enqueue only committed, freshly merged data, never the pre-probe snapshot.
    if (committed.asset) this.workflow?.record(committed.asset.id, committed.asset)
    return true
  }

  /** Synchronous merge, called only inside the IMMEDIATE writer transaction. */
  private commitProbe(path: string, observedId: string | null,
    technical: {contentHash: string; sizeBytes: number; modifiedAt: string}, probe: ProbeResult) {
    const existing = this.db.select().from(mediaAssets).where(eq(mediaAssets.path, path)).get()
    // A pending scan must not resurrect an entry removed/replaced by somebody
    // else, nor apply this pathname's probe to an ID moved to another path.
    if (observedId && existing?.id !== observedId) return { state: 'skipped' as const, asset: null }
    const { contentHash } = technical
    const base = {
      ...technical,
      path,
      title: existing?.title ?? titleFrom(path),
    }

    if (!probe.ok) {
      // Failed probing is not evidence of video. Don't create new VIDEO rows
      // for PDFs, documents or unknown files. Existing records remain intact
      // for historical references; the client also filters legacy mislabels.
      if (!hasVideoFileSuffix(path) && !existing) {
        return { state: 'skipped' as const, asset: null }
      }
      // O arquivo entra mesmo assim, com o motivo. Duração zero é honesta:
      // não sabemos, e fingir um número poria lixo na grade.
      const row = {
        ...base,
        kind: 'VIDEO' as const,
        videoCodec: null,
        durationFrames: 0,
        durationNs: null,
        width: null,
        height: null,
        rateNum: null,
        rateDen: null,
        interlaceMode: null,
        hasAudio: null,
        audioChannels: null,
        audioTracks: null,
        loudnessFile: null,
        probeError: probe.reason,
        qcStatus: 'FAILED' as const,
        qcNotes: probe.reason,
        qcCheckedAt: null,
        ignored: existing?.ignored ?? true,
      }
      return { state: 'failed' as const, asset: this.upsert(existing?.id ?? null, row) }
    }

    // Uma varredura rápida pode reprobar o arquivo só para atualizar metadados.
    // Se o conteúdo não mudou, preserve a medição de loudness já existente;
    // apagá-la deixa o nivelamento sem referência até a próxima análise.
    const sameContent = existing?.contentHash === contentHash
    const measuredLoudness = sameContent && existing?.loudnessFile != null
      ? existing.loudnessFile
      : probe.audio?.integratedLufs !== undefined
        ? {
            integratedLufs: probe.audio.integratedLufs,
            lra: probe.audio.lra ?? 0,
            truePeakDbtp: probe.audio.truePeakDbtp ?? -90,
            scope: 'FILE' as const,
            measuredAt: new Date().toISOString(),
          }
        : null
    const row = {
      ...base,
      // Vídeo sem cadência é imagem parada: tem quadro, não tem tempo. Quem
      // diz quanto ela fica no ar é a grade.
      kind: (probe.video
        ? probe.video.rateNum === 0
          ? 'STILL'
          : 'VIDEO'
        : 'AUDIO') as 'VIDEO' | 'AUDIO' | 'STILL',
      // Mantido só para o que foi semeado antes de existir sonda; quem conta é
      // `durationNs`, convertido na cadência de quem pergunta.
      durationFrames: 0,
      durationNs: probe.durationNs,
      width: probe.video?.width ?? null,
      height: probe.video?.height ?? null,
      rateNum: probe.video?.rateNum ?? null,
      rateDen: probe.video?.rateDen ?? null,
      interlaceMode: probe.video?.interlaceMode ?? null,
      hasAudio: Boolean(probe.audio),
      audioChannels: probe.audio?.channels ?? 0,
      audioTracks: probe.audioTracks ?? [],
      probeError: null,
      videoCodec: probe.videoCodec ?? null,
      loudnessFile: measuredLoudness,
      // Conteúdo efetivamente novo precisa passar pelo QC. Uma atualização de
      // metadados do mesmo hash não apaga uma homologação já registrada.
      qcStatus: sameContent && existing?.qcStatus !== 'FAILED' ? (existing?.qcStatus ?? 'APPROVED') : 'PENDING' as const,
      // Faixa de áudio presente mas medida em silêncio (porta absoluta BS.1770,
      // pico abaixo de −60 dBTP): quase sempre arquivo exportado sem som. Vai
      // na nota do QC, sem trocar a decisão já registrada pelo operador.
      qcNotes: sameContent && existing?.qcStatus !== 'FAILED' ? (existing?.qcNotes ?? silentAudioNote(probe.audio ? measuredLoudness : null)) : silentAudioNote(probe.audio ? measuredLoudness : null),
      qcCheckedAt: sameContent && existing?.qcStatus !== 'FAILED' ? (existing?.qcCheckedAt ?? null) : null,
      // Material sem imagem, sem áudio ou vertical 9:16 entra no acervo
      // ignorado. O operador pode aceitar manualmente; a decisão é preservada
      // em novas varreduras e reinicializações.
      ignored:
        existing?.ignored ??
        (!probe.video || !probe.audio ||
          (probe.video.height > 0 && probe.video.width / probe.video.height < 0.8)),
    }
    return { state: existing ? 'updated' as const : 'added' as const, asset: this.upsert(existing?.id ?? null, row) }
  }

  private async absorbSafely(path: string, ultimaChance = false): Promise<boolean> {
    try {
      return await this.absorb(path, ultimaChance)
    } catch (failure) {
      if (this.closed) return true
      const reason = failure instanceof Error ? failure.message : 'Falha ao ler o arquivo'
      await this.db.update(mediaAssets).set({ probeError: reason, qcStatus: 'FAILED', qcNotes: reason, qcCheckedAt: null }).where(eq(mediaAssets.path, path))
      this.patch({ failed: this.state.failed + 1, error: `${path}: ${reason}` })
      return true
    }
  }

  private upsert(id: string | null, values: Record<string, unknown>): typeof mediaAssets.$inferSelect {
    const assetId = id ?? randomUUID()
    if (id) {
      this.db.update(mediaAssets).set(values).where(eq(mediaAssets.id, id)).run()
    } else this.db.insert(mediaAssets).values({
      id: assetId,
      createdAt: new Date().toISOString(),
      ...values,
    } as typeof mediaAssets.$inferInsert).run()
    return this.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).get()!
  }

  /** Onde as miniaturas moram. A rota de quadros guarda os dela no mesmo lugar. */
  get thumbs(): string {
    return this.thumbnailDir
  }

  /**
   * Fitas em produção, por prefixo.
   *
   * A régua pede os dezesseis quadros de uma vez, e cada pedido que chegasse
   * antes do primeiro terminar mandaria abrir o arquivo de novo. Aqui todos
   * esperam a mesma leitura.
   */
  private readonly fitas = new Map<string, Promise<number>>()

  /**
   * Tira `quantos` quadros espalhados pelo arquivo, numa leitura só, gravando
   * `<prefixo>-0.jpg` ... `<prefixo>-(quantos-1).jpg`.
   *
   * Abrir e posicionar um arquivo grande custa segundos. Pedir quadro a quadro
   * multiplicava esse custo pelo tamanho da régua -- eram dezesseis aberturas
   * para montar uma fita, quase um minuto num VT de duas centenas de megabytes.
   *
   * Devolve quantos quadros saíram.
   */
  strip(path: string, quantos: number, prefixo: string, largura = 320, onlyFrame?:number): Promise<number> {
    if(this.closed)return Promise.resolve(0)
    const workKey=JSON.stringify([prefixo,onlyFrame??null])
    const emCurso = this.fitas.get(workKey)
    if (emCurso !== undefined) return emCurso

    const trabalho = new Promise<number>((done) => {
      if (!this.available) {
        done(0)
        return
      }
      // Quem cria a pasta de miniaturas é a varredura. Uma instalação onde
      // ninguém varreu ainda -- ou onde alguém limpou a pasta -- deixaria a
      // sonda escrevendo em lugar nenhum, e a régua pediria a fita de novo a
      // cada quadro, para sempre.
      try {
        mkdirSync(dirname(prefixo), { recursive: true })
      } catch {
        // Sem permissão de criar, a sonda falha logo abaixo e a régua cai na
        // miniatura de sempre.
      }
      const child = spawn(this.probeBinary, [
        path,
        '--thumbnail',
        prefixo,
        '--fita',
        String(quantos),
        ...(onlyFrame===undefined?[]:['--only-frame',String(onlyFrame)]),
        '--largura',
        String(largura),
        '--no-loudness',
        '--parent-pipe',
      ], { windowsHide: true, env: mediaProcessEnvironment(),stdio:['pipe','pipe','pipe'] })
      this.track(child)
      let settled = false
      const finish = (count: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        done(count)
      }
      const timeout = setTimeout(() => { finish(0); child.kill() }, 120_000)
      child.stderr?.resume()
      try {
        if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW)
      } catch {
        // Igual à varredura: sem prioridade baixa ainda funciona.
      }
      let out = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        out = (out + chunk.toString()).slice(-1_000_000)
      })
      child.on('error', () => finish(0))
      child.on('close', () => {
        const line = out.trim().split('\n').pop() ?? ''
        try {
          const resultado = JSON.parse(line) as ProbeResult & {frameRecipe?:string}
          finish(resultado.ok && (onlyFrame===undefined || resultado.frameRecipe==='qc-frame-v3') ? Number(resultado.thumbnail ?? '0') : 0)
        } catch {
          finish(0)
        }
      })
    }).finally(() => {
      this.fitas.delete(workKey)
    })

    this.fitas.set(workKey, trabalho)
    return trabalho
  }

  /** Roda a sonda e lê a linha de JSON. Falha dela nunca derruba a varredura. */
  private probe(path: string, thumbnail: string): Promise<ProbeResult> {
    if(this.closed)return Promise.resolve({ok:false,reason:'Scanner encerrando.'})
    return new Promise((done) => {
      const args = [path, '--thumbnail', thumbnail,'--parent-pipe']
      // Medir loudness custa decodificar o áudio inteiro de cada arquivo. Num
      // acervo grande isso são horas de CPU -- e o canal está no ar ao lado.
      if (!this.measuring) args.push('--no-loudness')

      const child = spawn(this.probeBinary, args, { windowsHide: true, env: mediaProcessEnvironment(),stdio:['pipe','pipe','pipe'] })
      this.track(child)
      let settled = false
      const finish = (result: ProbeResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        done(result)
      }
      // Limite global: mensagens de bus não podem manter uma sonda presa para sempre.
      const timeout = setTimeout(() => {
        finish({ ok: false, reason: 'A análise excedeu 15 minutos. Confira o arquivo e tente novamente.' })
        child.kill()
      }, 15 * 60_000)
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096) })

      // A sonda nunca disputa CPU com o ar. Ela pode demorar o dobro; o
      // programa não pode engasgar um frame.
      try {
        if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW)
      } catch {
        // Sistema que não deixa mudar prioridade: a varredura roda igual.
      }
      let out = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        out = (out + chunk.toString()).slice(-1_000_000)
      })
      child.on('error', (error) => finish({ ok: false, reason: error.message }))
      child.on('close', () => {
        const line = out.trim().split('\n').pop() ?? ''
        try {
          const result = JSON.parse(line) as ProbeResult
          if (typeof result.ok !== 'boolean') throw new Error('resposta inválida')
          finish(result)
        } catch {
          finish({ ok: false, reason: stderr.trim() || 'a sonda não devolveu resposta' })
        }
      })
    })
  }
}

/** Percorre a árvore inteira. A organização em disco é a que o operador vê. */
/** O caminho está sob a pasta? Comparação por segmento, não por prefixo de texto. */
function dentroDe(root: string, alvo: string): boolean {
  const raiz = resolve(root)
  const caminho = resolve(alvo)
  return caminho === raiz || caminho.startsWith(raiz + sep)
}

async function walk(root: string, aoEntrar?: (dir: string, achados: number) => void,
  onError?: (dir: string, error: string) => void,closed:()=>boolean=()=>false): Promise<string[]> {
  const found: string[] = []
  const pending = [root]
  // Atalho que aponta para uma pasta acima fecha um ciclo, e o laço nunca
  // acaba. Numa pasta de rede isso não é hipótese: é o caso do dia em que
  // alguém cria um atalho para a raiz dentro de uma subpasta.
  const visitados = new Set<string>()

  while (pending.length > 0&&!closed()) {
    const dir = pending.pop()
    if (dir === undefined) break
    const real = resolve(dir)
    if (visitados.has(real)) continue
    visitados.add(real)
    aoEntrar?.(dir, found.length)

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (failure) {
      onError?.(dir, failure instanceof Error ? failure.message : 'pasta inacessível')
      // Pasta sem permissão não interrompe a varredura do resto.
      continue
    }

    for (const entry of entries) {
      if(closed())break
      if (entry.name.startsWith('.') || SKIP.has(entry.name) || SYSTEM_FILES.has(entry.name.toLowerCase())) continue
      const full = join(dir, entry.name)
      // Atalho não é pasta nem arquivo para a varredura: seguir um leva a
      // percorrer duas vezes a mesma coisa, ou a sair da pasta do acervo.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) pending.push(full)
      // Lista de reprodução não é mídia: ela é lida em outro lugar.
      else if (entry.isFile() && !isPlaylist(full)) found.push(full)
    }
  }

  return found.sort()
}

/** SHA-256 em fluxo: arquivo de mídia não cabe na memória. */
function hashFile(path: string,signal?:AbortSignal): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path,{signal})
    let error:Error|undefined,digest:string|undefined
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', cause=>{error=cause})
    stream.on('end', () => {digest=hash.digest('hex')})
    stream.on('close',()=>{if(error)fail(error);else if(digest)done(digest);else fail(new Error('Leitura encerrada antes do hash completo.'))})
  })
}

/** Título de partida: o nome do arquivo sem extensão, com separadores virando espaço. */
function titleFrom(path: string): string {
  const name = basename(path, extname(path))
  return name.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim() || name
}
