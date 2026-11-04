import type { Distribution } from '../types.js'

export const NO_MEDIA_SERVER = 'Servidor de mídia (MediaMTX) desligado nesta instalação: nenhum ponto de acesso RTSP, RTMP, SRT, HLS ou WebRTC está publicado. As saídas configuradas abaixo seguem valendo.'

/** Endereços de programa que existem de fato. Sem servidor de mídia o
 * servidor ainda calcula os endereços, mas nenhum deles atende (B9: a tela
 * listava 192.0.2.2 em cinco protocolos sem nada escutando). */
export function publishedStreamUrls(distribution: Distribution | null | undefined, channelId: string): { urls: Record<string, string> | null; reason: string | null } {
  if (!distribution) return { urls: null, reason: null }
  if (!distribution.server.running) return { urls: null, reason: NO_MEDIA_SERVER }
  const urls = distribution.channels.find(entry => entry.channelId === channelId)?.urls ?? null
  return { urls: urls && Object.keys(urls).length ? urls : null, reason: null }
}
