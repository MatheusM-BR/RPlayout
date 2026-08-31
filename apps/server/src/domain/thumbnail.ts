import type { MediaAsset, Rate } from '@rplayout/protocol'
import { formatDuration } from '@rplayout/protocol'

/**
 * Miniatura de reserva, desenhada a partir do hash do arquivo.
 *
 * Enquanto o ingest não extrai um frame de verdade, o explorador precisa de
 * alguma coisa estável para mostrar — e uma cor derivada do conteúdo faz o
 * operador reconhecer o arquivo de relance, o que um retângulo cinza não faz.
 */
export function thumbnailSvg(asset: MediaAsset, rate: Rate): string {
  const seed = Number.parseInt(asset.contentHash.slice(0, 8), 16)
  // Faixa de azuis e ciano-arroxeados, para não brigar com a paleta da tela.
  const hue = 200 + (seed % 60)
  const tilt = 12 + (seed % 24)

  const initials = asset.title
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

  const duration = formatDuration(asset.durationFrames, rate)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 46% 22%)"/>
      <stop offset="1" stop-color="hsl(${hue + tilt} 52% 11%)"/>
    </linearGradient>
  </defs>
  <rect width="160" height="90" fill="url(#g)"/>
  <g fill="hsl(${hue} 40% 8%)" opacity="0.55">
    <rect x="0" y="0" width="12" height="90"/>
    <rect x="148" y="0" width="12" height="90"/>
  </g>
  <g fill="hsl(${hue} 30% 30%)">
    ${[6, 24, 42, 60, 78]
      .map((y) => `<rect x="3" y="${y}" width="6" height="8" rx="1"/><rect x="151" y="${y}" width="6" height="8" rx="1"/>`)
      .join('\n    ')}
  </g>
  <text x="80" y="50" text-anchor="middle"
        font-family="Barlow Condensed, Arial Narrow, sans-serif" font-size="34" font-weight="700"
        fill="hsl(${hue} 70% 78%)" opacity="0.9">${initials}</text>
  <rect x="0" y="72" width="160" height="18" fill="rgba(6,9,15,0.72)"/>
  <text x="152" y="85" text-anchor="end"
        font-family="IBM Plex Mono, monospace" font-size="11" fill="#b6c8e8">${duration}</text>
</svg>`
}
