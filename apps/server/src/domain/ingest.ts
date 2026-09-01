import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AudioTrack } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { mediaAssets } from '../db/schema.js'

/** O que a sonda devolve. Uma linha de JSON, sucesso ou motivo da falha. */
type ProbeResult =
  | {
      ok: true
      durationNs: number
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
  readonly root: string | null
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

/** Pastas que a varredura nunca desce. */
const SKIP = new Set(['.git', 'node_modules', '.thumbs'])

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
export class Ingest {
  private state: IngestStatus = {
    running: false,
    root: null,
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

  constructor(
    private readonly db: Db,
    /** Binário da sonda. Vazio deixa o acervo como está. */
    private readonly probeBinary: string,
    /** Onde as miniaturas ficam. */
    private readonly thumbnailDir: string,
  ) {}

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
  start(root: string): boolean {
    if (this.state.running || !this.available) return false
    this.state = {
      running: true,
      root,
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
    void this.run(root)
    return true
  }

  private patch(change: Partial<IngestStatus>): void {
    this.state = { ...this.state, ...change }
  }

  private async run(root: string): Promise<void> {
    try {
      const files = await walk(resolve(root))
      this.patch({ total: files.length })
      await mkdir(this.thumbnailDir, { recursive: true })

      for (const file of files) {
        this.patch({ current: file, seen: this.state.seen + 1 })
        await this.absorb(file)
      }
      this.patch({ running: false, current: null, finishedAt: new Date().toISOString() })
      this.onFinished?.()
    } catch (failure) {
      this.patch({
        running: false,
        current: null,
        finishedAt: new Date().toISOString(),
        error: failure instanceof Error ? failure.message : 'A varredura falhou.',
      })
      // Mesmo tendo falhado no meio, o que já entrou tem que chegar à grade.
      this.onFinished?.()
    }
  }

  private async absorb(path: string): Promise<void> {
    const info = await stat(path)
    if (Date.now() - info.mtimeMs < SETTLE_MS) {
      // Ainda mudando: fica para a próxima varredura.
      this.patch({ skipped: this.state.skipped + 1 })
      return
    }

    const modifiedAt = info.mtime.toISOString()
    const [existing] = await this.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.path, path))
      .limit(1)

    // Tamanho e data iguais: nada mudou, e reler para descobrir isso custaria
    // ler o acervo inteiro a cada varredura.
    if (existing && existing.sizeBytes === info.size && existing.modifiedAt === modifiedAt) {
      this.patch({ skipped: this.state.skipped + 1 })
      return
    }

    const contentHash = await hashFile(path)
    const thumbnail = join(this.thumbnailDir, `${contentHash}.jpg`)
    const probe = await this.probe(path, thumbnail)

    const base = {
      contentHash,
      path,
      title: existing?.title ?? titleFrom(path),
      sizeBytes: info.size,
      modifiedAt,
    }

    if (!probe.ok) {
      // O arquivo entra mesmo assim, com o motivo. Duração zero é honesta:
      // não sabemos, e fingir um número poria lixo na grade.
      const row = {
        ...base,
        kind: 'VIDEO' as const,
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
        probeError: probe.reason,
      }
      await this.upsert(existing?.id ?? null, row)
      this.patch({ failed: this.state.failed + 1 })
      return
    }

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
      loudnessFile:
        probe.audio?.integratedLufs !== undefined
          ? {
              integratedLufs: probe.audio.integratedLufs,
              lra: probe.audio.lra ?? 0,
              truePeakDbtp: probe.audio.truePeakDbtp ?? -90,
              scope: 'FILE' as const,
              measuredAt: new Date().toISOString(),
            }
          : null,
    }
    await this.upsert(existing?.id ?? null, row)
    this.patch(
      existing ? { updated: this.state.updated + 1 } : { added: this.state.added + 1 },
    )
  }

  private async upsert(id: string | null, values: Record<string, unknown>): Promise<void> {
    if (id) {
      await this.db.update(mediaAssets).set(values).where(eq(mediaAssets.id, id))
      return
    }
    await this.db.insert(mediaAssets).values({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...values,
    } as typeof mediaAssets.$inferInsert)
  }

  /** Roda a sonda e lê a linha de JSON. Falha dela nunca derruba a varredura. */
  private probe(path: string, thumbnail: string): Promise<ProbeResult> {
    return new Promise((done) => {
      const child = spawn(this.probeBinary, [path, '--thumbnail', thumbnail])
      let out = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      child.on('error', (error) => done({ ok: false, reason: error.message }))
      child.on('close', () => {
        const line = out.trim().split('\n').pop() ?? ''
        try {
          done(JSON.parse(line) as ProbeResult)
        } catch {
          done({ ok: false, reason: 'a sonda não devolveu resposta' })
        }
      })
    })
  }
}

/** Percorre a árvore inteira. A organização em disco é a que o operador vê. */
async function walk(root: string): Promise<string[]> {
  const found: string[] = []
  const pending = [root]

  while (pending.length > 0) {
    const dir = pending.pop()
    if (dir === undefined) break

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Pasta sem permissão não interrompe a varredura do resto.
      continue
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) found.push(full)
    }
  }

  return found.sort()
}

/** SHA-256 em fluxo: arquivo de mídia não cabe na memória. */
function hashFile(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', fail)
    stream.on('end', () => done(hash.digest('hex')))
  })
}

/** Título de partida: o nome do arquivo sem extensão, com separadores virando espaço. */
function titleFrom(path: string): string {
  const name = basename(path, extname(path))
  return name.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim() || name
}
