import { formatDuration, framesToSeconds, wholeSeconds, type Frames, type Rate } from '@rplayout/protocol'
import type { RundownView } from './plan.js'
import { sourceAddress } from './source-wire.js'

const esc = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1")}"`
const DAY_SECONDS = 86_400

/** Hora do dia (HH:MM:SS) da grade; numa grade em loop que passa da meia-noite, "D+1 HH:MM:SS". */
export function gradeClock(frames: Frames, rate: Rate): string {
  const total = wholeSeconds(frames, rate)
  const day = Math.floor(total / DAY_SECONDS)
  const rest = total % DAY_SECONDS, two = (value: number) => String(value).padStart(2, '0')
  const text = `${two(Math.floor(rest / 3600))}:${two(Math.floor((rest % 3600) / 60))}:${two(rest % 60)}`
  return day > 0 ? `D+${day} ${text}` : text
}

const anchorLabel: Record<string, string> = { FLOW: 'SEQUÊNCIA', FIXED: 'HORA FIXA', HARD_TIME: 'HORÁRIO DE REDE', SOFT: 'HORA ALVO' }
const stateLabel: Record<string, string> = { PENDING: 'AGENDADO', ON_AIR: 'NO AR', DONE: 'EXIBIDO', DROPPED: 'DESCARTADO' }

/**
 * Grade para planilha (M9): horários e durações em HH:MM:SS (o que o operador
 * lê), com os quadros em colunas próprias para quem precisa do exato.
 */
export function gradeCsv(view: RundownView): string {
  const rate = view.channel.rate
  const lines = ['ordem;item;tipo;arquivo/fonte;entrada prevista;duração;âncora;hora da âncora;estado;ajuste;entrada (quadros);duração (quadros)']
  view.items.forEach((entry, index) => {
    const planned = view.schedule.items.find((row) => row.id === entry.item.id)
    const anchor = entry.item.anchor
    const adjust = planned?.adjustments.map((adjustment) => adjustment.reason).join(' | ') ?? ''
    lines.push([
      index + 1,
      esc(entry.item.title),
      esc(entry.item.type),
      esc(entry.asset?.path ?? sourceAddress(entry.item.sourceRef ?? '')),
      esc(planned ? gradeClock(planned.start, rate) : ''),
      esc(planned ? formatDuration(planned.duration, rate) : ''),
      esc(anchorLabel[anchor.kind] ?? anchor.kind),
      esc('at' in anchor ? gradeClock(anchor.at, rate) : ''),
      esc(planned ? stateLabel[planned.state] ?? planned.state : ''),
      esc(adjust),
      esc(planned?.start ?? ''),
      esc(planned?.duration ?? ''),
    ].join(';'))
  })
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Grade como M3U estendido (#EXTINF com segundos), relida pela importação. Ao vivo vira comentário. */
export function gradeM3u(view: RundownView): string {
  const rate = view.channel.rate
  const lines = ['#EXTM3U', `#PLAYLIST:${view.rundown.name.replace(/[\r\n]+/g, ' ')}${view.rundown.date ? ` ${view.rundown.date}` : ''}`]
  for (const entry of view.items) {
    const planned = view.schedule.items.find((row) => row.id === entry.item.id)
    if (planned?.state === 'DROPPED') continue
    const seconds = Math.round(framesToSeconds(planned?.duration ?? 0, rate) * 1000) / 1000
    const title = entry.item.title.replace(/[\r\n,]+/g, ' ')
    if (!entry.asset?.path) { lines.push(`# AO VIVO / SEM ARQUIVO: ${title} (${formatDuration(planned?.duration ?? 0, rate)})`); continue }
    lines.push(`#EXTINF:${seconds},${title}`, entry.asset.path)
  }
  return lines.join('\r\n') + '\r\n'
}
