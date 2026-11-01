import type { FastifyInstance } from 'fastify'

/** Leitura lenta o bastante para merecer uma linha mesmo dando certo. */
export const SLOW_REQUEST_MS = 1000

/**
 * Registro de requisições sem o ruído do polling.
 *
 * O Fastify escrevia duas linhas JSON por requisição ("incoming request" e
 * "request completed"). Com a interface lendo dezenas de rotas por minuto por
 * aba, isso era serialização, escrita no stdout e -- na captura dos logs
 * técnicos -- um JSON.parse por linha só para descartá-la. Agora sai uma linha
 * por requisição que interessa a quem investiga: comando (não-GET), erro
 * (>= 400) ou leitura lenta. Leitura rotineira bem-sucedida não deixa linha.
 */
export function shouldLogRequest(method: string, statusCode: number, elapsedMs: number): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) || statusCode >= 400 || elapsedMs >= SLOW_REQUEST_MS
}

export function registerRequestLog(server: FastifyInstance): void {
  server.addHook('onResponse', async (request, reply) => {
    const elapsed = reply.elapsedTime
    if (!shouldLogRequest(request.method, reply.statusCode, elapsed)) return
    const line = { req: request, res: reply, responseTime: Math.round(elapsed * 10) / 10 }
    if (reply.statusCode >= 500) request.log.error(line, 'request completed')
    else if (reply.statusCode >= 400) request.log.warn(line, 'request completed')
    else request.log.info(line, 'request completed')
  })
}
