import type { Channel, MediaAsset, Rundown, RundownItem } from '@rplayout/protocol'
import { buildView } from './plan.js'

/** A grade publicada no formato XMLTV consumido por operadoras e OTTs. */
export interface XmltvSchedule {
  readonly channel: Channel
  readonly rundowns: readonly {
    readonly rundown: Rundown
    readonly items: readonly RundownItem[]
  }[]
  readonly assets: ReadonlyMap<string, MediaAsset>
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmltvTime(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())} +0000`
}

function dateAtFrames(date: string, frames: number, rate: Channel['rate']): Date {
  // A data da grade é civil e não traz fuso. XMLTV deixa o offset explícito;
  // usamos UTC para que o mesmo banco produza o mesmo feed em qualquer host.
  const midnight = new Date(`${date}T00:00:00.000Z`)
  return new Date(midnight.getTime() + (frames * rate.den * 1000) / rate.num)
}

/**
 * Serializa a grade resolvida, não o as-run: EPG informa o que será exibido.
 * Itens descartados pelo scheduler não são anunciados aos distribuidores.
 */
export function exportXmltv(schedule: XmltvSchedule): string {
  const programmes: string[] = []
  for (const source of schedule.rundowns) {
    const view = buildView(source.rundown, schedule.channel, source.items, schedule.assets, null, null)
    for (const entry of view.schedule.items) {
      if (entry.state === 'DROPPED' || entry.duration <= 0) continue
      const item = view.items.find((candidate) => candidate.item.id === entry.id)?.item
      if (!item) continue
      const start = dateAtFrames(source.rundown.date, entry.start, schedule.channel.rate)
      const stop = dateAtFrames(source.rundown.date, entry.end, schedule.channel.rate)
      programmes.push(`  <programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="${escapeXml(schedule.channel.id)}">\n    <title lang="pt-BR">${escapeXml(item.title)}</title>\n    <category lang="pt-BR">${escapeXml(item.type)}</category>\n    <desc lang="pt-BR">Grade RPlayout: ${escapeXml(item.title)}</desc>\n  </programme>`)
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="RPlayout Broadcast Automation">\n  <channel id="${escapeXml(schedule.channel.id)}">\n    <display-name lang="pt-BR">${escapeXml(schedule.channel.name)}</display-name>\n  </channel>\n${programmes.join('\n')}\n</tv>\n`
}
