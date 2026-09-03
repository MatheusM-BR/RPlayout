import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { constants, setPriority } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
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
const VANISHED = 'o arquivo não está mais na pasta'

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
  start(roots: string | readonly string[]): boolean {
    if (this.state.running || !this.available) return false
    const pastas = (typeof roots === 'string' ? [roots] : roots).map((entry) => resolve(entry))
    if (pastas.length === 0) return false
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
    void this.run(pastas)
    return true
  }

  private patch(change: Partial<IngestStatus>): void {
    this.state = { ...this.state, ...change }
  }

  private async run(roots: readonly string[]): Promise<void> {
    try {
      // Anda por todas as pastas antes de absorver qualquer coisa: o total é o
      // que a interface mostra como progresso, e ele não pode crescer no meio.
      const files: string[] = []
      for (const root of roots) files.push(...(await walk(root)))
      // A mesma pasta apontada duas vezes não faz o arquivo entrar duas vezes.
      const unicos = [...new Set(files)].sort()
      this.patch({ total: unicos.length })
      await mkdir(this.thumbnailDir, { recursive: true })

      const mudando: string[] = []
      for (const file of unicos) {
        this.patch({ current: file, seen: this.state.seen + 1 })
        if (!(await this.absorb(file))) mudando.push(file)
      }
      await this.esperarOsQueMudavam(mudando)
      await this.markVanished(roots, unicos)
      await this.tirarListas()
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

    while (pendentes.length > 0 && Date.now() < limite) {
      this.patch({ current: `${pendentes[0]} (esperando a cópia terminar)` })
      await new Promise((pronto) => setTimeout(pronto, 2_000))
      const restam: string[] = []
      for (const arquivo of pendentes) {
        if (!(await this.absorb(arquivo))) restam.push(arquivo)
      }
      pendentes = restam
    }

    // Passou da hora e ainda mudam: entram na conta de pulados, com a última
    // chance marcada para o contador não ficar mentindo.
    for (const arquivo of pendentes) await this.absorb(arquivo, true)
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
    const info = await stat(path)
    if (Date.now() - info.mtimeMs < SETTLE_MS) {
      // Ainda mudando. Volta no fim da varredura, quando tiver parado.
      if (!ultimaChance) return false
      this.patch({ skipped: this.state.skipped + 1 })
      return true
    }

    const modifiedAt = info.mtime.toISOString()
    const [existing] = await this.db
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
    const faltaMedir = this.measure && existing?.loudnessFile == null
    if (
      existing &&
      existing.sizeBytes === info.size &&
      existing.modifiedAt === modifiedAt &&
      !faltaMedir
    ) {
      this.patch({ skipped: this.state.skipped + 1 })
      return true
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
      return true
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
    return true
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
  strip(path: string, quantos: number, prefixo: string, largura = 320): Promise<number> {
    const emCurso = this.fitas.get(prefixo)
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
        '--largura',
        String(largura),
        '--no-loudness',
      ])
      try {
        if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW)
      } catch {
        // Igual à varredura: sem prioridade baixa ainda funciona.
      }
      let out = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      child.on('error', () => done(0))
      child.on('close', () => {
        const line = out.trim().split('\n').pop() ?? ''
        try {
          const resultado = JSON.parse(line) as ProbeResult
          done(resultado.ok ? Number(resultado.thumbnail ?? '0') : 0)
        } catch {
          done(0)
        }
      })
    }).finally(() => {
      this.fitas.delete(prefixo)
    })

    this.fitas.set(prefixo, trabalho)
    return trabalho
  }

  /** Roda a sonda e lê a linha de JSON. Falha dela nunca derruba a varredura. */
  private probe(path: string, thumbnail: string): Promise<ProbeResult> {
    return new Promise((done) => {
      const args = [path, '--thumbnail', thumbnail]
      // Medir loudness custa decodificar o áudio inteiro de cada arquivo. Num
      // acervo grande isso são horas de CPU -- e o canal está no ar ao lado.
      if (!this.measure) args.push('--no-loudness')

      const child = spawn(this.probeBinary, args)

      // A sonda nunca disputa CPU com o ar. Ela pode demorar o dobro; o
      // programa não pode engasgar um frame.
      try {
        if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW)
      } catch {
        // Sistema que não deixa mudar prioridade: a varredura roda igual.
      }
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
/** O caminho está sob a pasta? Comparação por segmento, não por prefixo de texto. */
function dentroDe(root: string, alvo: string): boolean {
  const raiz = resolve(root)
  const caminho = resolve(alvo)
  return caminho === raiz || caminho.startsWith(raiz + sep)
}

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
      // Lista de reprodução não é mídia: ela é lida em outro lugar.
      else if (entry.isFile() && !isPlaylist(full)) found.push(full)
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
