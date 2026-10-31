/**
 * Carimbo de quem construiu esta interface, injetado pelo Vite.
 *
 * Serve para responder de olho na tela a pergunta "esta build é a nova?" --
 * numa máquina de playout a interface é um arquivo estático, e uma build velha
 * continua funcionando perfeitamente com o código de ontem.
 */
declare const __BUILD_COMMIT__: string
declare const __BUILD_TIME__: string

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'desconhecido'

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/** Data da build no jeito que se lê aqui, ou vazio quando não há. */
export function buildDate(): string {
  if (BUILD_TIME === '') return ''
  const quando = new Date(BUILD_TIME)
  if (Number.isNaN(quando.getTime())) return ''
  return quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
