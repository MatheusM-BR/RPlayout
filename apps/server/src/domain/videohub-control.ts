import net from 'node:net'

export interface DeviceReply { success: boolean; details?: Record<string, unknown> }

/** Blackmagic Ethernet Protocol v2.3. ACK acknowledges a request, not a route:
 * https://documents.blackmagicdesign.com/DeveloperManuals/VideohubEthernetProtocol.pdf
 * Confirm the requested crosspoint from a subsequent solicited status dump.
 * No retries: a timeout after writing can mean an uncertain physical operation. */
export class VideohubRouterDriver {
  constructor(private readonly host = '127.0.0.1', private readonly port = 9990,
    private readonly simulated = false, private readonly timeoutMs = 1500) {}

  async execute(action: string, params: Record<string, unknown>, canDispatch?: () => boolean): Promise<DeviceReply> {
    const kind = action.toUpperCase()
    if (!['PING', 'ROUTE', 'ROUTE_CROSSPOINT'].includes(kind)) return { success: false, details: { error: 'Ação Videohub não suportada. Use PING ou ROUTE_CROSSPOINT.' } }
    const destination = params.destination ?? params.dest ?? params.output
    const source = params.source ?? params.src ?? params.input
    const validPort = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 65_535
    if (kind !== 'PING' && (!validPort(destination) || !validPort(source))) return { success: false, details: { error: 'Informe entrada e saída inteiras a partir de zero; nenhum crosspoint padrão é assumido.' } }
    if (this.simulated) return { success: true, details: { simulated: true, physicalExecutionConfirmed: false, routeStatusConfirmed: false, action: kind, destination, source } }

    return new Promise(resolve => {
      const socket = new net.Socket()
      let done = false, pending = '', block: string[] = [], blockBytes = 0
      let protocol = false, device = false, inputs = 0, outputs = 0, model = ''
      let phase: 'PRELUDE' | 'PING_ACK' | 'ROUTE_ACK' | 'STATUS_ACK' | 'STATUS' = 'PRELUDE'
      let statusSource: number | null = null, acknowledged = false
      const finish = (reply: DeviceReply) => {
        if (done) return
        done = true; clearTimeout(timeout); socket.destroy(); resolve(reply)
      }
      const fail = (error: string, stateKnown = false) => finish({ success: false, details: { error, acknowledged, uncertain: !stateKnown && kind !== 'PING' && ['ROUTE_ACK', 'STATUS_ACK', 'STATUS'].includes(phase), physicalExecutionConfirmed: false, host: this.host, port: this.port } })
      const timeout = setTimeout(() => fail('TIMEOUT_VIDEOHUB_CONFIRMATION: sem confirmação do equipamento; não há reenvio automático.'), this.timeoutMs)
      const send = (command: string) => socket.write(command, error => { if (error) fail('Falha ao enviar comando Videohub.') })
      const ping = () => {
        if (phase !== 'PRELUDE' || !protocol || !device) return
        if (kind !== 'PING' && ((destination as number) >= outputs || (source as number) >= inputs)) { fail('Entrada/saída fora dos limites informados pelo Videohub.'); return }
        phase = 'PING_ACK'; send('PING:\n\n')
      }
      const consume = (lines: string[]) => {
        const header = lines[0]
        if (header === 'PROTOCOL PREAMBLE:') {
          const version = lines.find(line => line.startsWith('Version:'))?.slice(8).trim()
          if (!/^2\.\d+$/.test(version ?? '')) { fail('Versão de protocolo Videohub incompatível.'); return }
          protocol = true; ping()
        } else if (header === 'VIDEOHUB DEVICE:') {
          const values = Object.fromEntries(lines.slice(1).map(line => { const split = line.indexOf(':'); return [line.slice(0, split).trim(), line.slice(split + 1).trim()] }))
          if (values['Device present'] !== 'true') { fail('Videohub sem equipamento disponível ou firmware incompatível.'); return }
          inputs = Number(values['Video inputs']); outputs = Number(values['Video outputs']); model = values['Model name'] ?? ''
          if (!Number.isSafeInteger(inputs) || !Number.isSafeInteger(outputs) || inputs <= 0 || outputs <= 0) { fail('Videohub não informou limites válidos de entradas/saídas.'); return }
          device = true; ping()
        } else if (header === 'NAK') {
          if (phase !== 'PRELUDE') fail('Videohub recusou o pedido (NAK); confirme o estado no equipamento.', phase === 'ROUTE_ACK')
        } else if (header === 'ACK') {
          if (phase === 'PING_ACK') {
            if (kind === 'PING') { finish({ success: true, details: { protocolResponding: true, physicalExecutionConfirmed: false, routeStatusConfirmed: false, model, inputs, outputs, host: this.host, port: this.port } }); return }
            let allowed = true
            try { if (canDispatch) allowed = canDispatch() } catch { allowed = false }
            if (!allowed) { fail('Contexto operacional mudou antes do roteamento. Nenhum crosspoint foi enviado.', true); return }
            phase = 'ROUTE_ACK'; send(`VIDEO OUTPUT ROUTING:\n${destination} ${source}\n\n`)
          } else if (phase === 'ROUTE_ACK') {
            acknowledged = true; phase = 'STATUS_ACK'; statusSource = null
            send('VIDEO OUTPUT ROUTING:\n\n')
          } else if (phase === 'STATUS_ACK') phase = 'STATUS'
        } else if (header === 'VIDEO OUTPUT ROUTING:' && phase === 'STATUS') {
          for (const line of lines.slice(1)) {
            const match = /^(\d+)\s+(\d+)$/.exec(line)
            if (match && Number(match[1]) === destination) statusSource = Number(match[2])
          }
        }
      }
      socket.setEncoding('utf8')
      socket.on('data', text => {
        if (done) return
        pending += text
        if (Buffer.byteLength(pending) + blockBytes > 262_144) { fail('Resposta Videohub excedeu o limite de segurança.'); return }
        let end: number
        while (!done && (end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1)
          if (line) { block.push(line); blockBytes += Buffer.byteLength(line) + 1 }
          else if (block.length) { const complete = block; block = []; blockBytes = 0; consume(complete) }
        }
        // Process every complete block in the chunk first: a later conflicting
        // update in the same response must not be hidden by the first match.
        if (!done && phase === 'STATUS' && statusSource !== null && !block.length && !pending) {
          if (statusSource !== source) { fail('Videohub respondeu com outro crosspoint; roteamento solicitado não confirmado.', true); return }
          finish({ success: true, details: { acknowledged: true, routeStatusConfirmed: true, physicalExecutionConfirmed: false, destination, source: statusSource, model, inputs, outputs, host: this.host, port: this.port } })
        }
      })
      socket.on('error', () => fail('Não foi possível conectar ao Videohub; confira endereço/porta no servidor.'))
      socket.on('close', () => { if (!done) fail('Conexão Videohub encerrou antes da confirmação; estado do comando incerto.') })
      socket.connect(this.port, this.host)
    })
  }
}
