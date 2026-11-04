import { describe, expect, it } from 'vitest'
import { DiagnosticLines, sanitizeDiagnostic, diagnosticValue } from './sanitize-diagnostic.js'
import { containsCredential } from './credential-detection.js'

describe('diagnósticos sem credenciais', () => {
  it('redige telemetria estruturada recursivamente sem modificar o estado executável',()=>{
    const value={state:{preview:{sourceRef:'srt://host:9000?passphrase=STATE_SECRET&latency=120'},sources:[{source:'rtmp://host/live/KEY_SECRET'}]},health:{error:'https://host/HOOK_SECRET falhou'},headers:{Authorization:'Bearer AUTH_SECRET'},token:'TOKEN_SECRET',password:null,metrics:[null,0,true,'Ação — Câmera']}
    const result=diagnosticValue(value)
    for(const secret of ['STATE_SECRET','KEY_SECRET','HOOK_SECRET','AUTH_SECRET','TOKEN_SECRET'])expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.metrics).toEqual(value.metrics);expect(result.password).toBeNull()
    expect(result.state.preview.sourceRef).toContain('latency=120')
    expect(value.state.preview.sourceRef).toContain('STATE_SECRET')
    expect(value.headers.Authorization).toBe('Bearer AUTH_SECRET')
  })
  it('preserva motivo e caracteres especiais sem expor URL, chave ou campos de senha', () => {
    const output = sanitizeDiagnostic('Não conectou srt://user:password-fixture@host:9000?latency=120&passphrase=srt-fixture; rtmp://host/app/rtmp-fixture, https://webhook.test/token-fixture?a=query-fixture. PASSWORD="field fixture" {"apiKey":"json-fixture"} Authorization: Bearer bearer-fixture')
    for (const secret of ['password-fixture', 'srt-fixture', 'rtmp-fixture', 'token-fixture', 'query-fixture', 'field fixture', 'json-fixture', 'bearer-fixture']) expect(output).not.toContain(secret)
    expect(output).toContain('Não conectou'); expect(output).toContain('latency=120')
    expect(output).toContain('https://webhook.test/REDACTED')
    expect(sanitizeDiagnostic('Arquivo C:\\Vídeos\\AÇÃO.mp4 não encontrado')).toBe('Arquivo C:\\Vídeos\\AÇÃO.mp4 não encontrado')
  })
  it('segura linhas completas e UTF-8 mesmo quando URL/credencial estão divididas entre chunks', () => {
    const lines: string[] = [], stream = new DiagnosticLines(line => lines.push(line))
    const bytes = Buffer.from('Não conectou srt://host:9000?passphrase=split-fixture\r\nÚltima linha sem newline')
    for (const byte of bytes) stream.write(Buffer.from([byte]))
    expect(lines).toHaveLength(1); expect(lines[0]).toContain('Não conectou'); expect(lines[0]).not.toContain('split-fixture')
    stream.end(); expect(lines[1]).toBe('Última linha sem newline')
  })
  it('omite a linha inteira acima do limite e retoma apenas na próxima linha', () => {
    const lines: string[] = [], stream = new DiagnosticLines(line => lines.push(line), 24)
    stream.write(Buffer.from('srt://host?passphrase=partial-fixture')); stream.write(Buffer.from('more-secret\nok\n'))
    stream.end()
    expect(lines.join('\n')).not.toContain('partial-fixture'); expect(lines.join('\n')).not.toContain('more-secret')
    expect(lines).toEqual(['[linha de diagnóstico excedeu o limite e foi omitida]', 'ok'])
  })
  // Revisão r88-37 (M2): os mesmos casos da detecção de credencial. O texto
  // mascarado não contém o segredo e não conta mais como credencial.
  it.each([
    ['srt://h:9000?mode=caller&streamid=#!::u=a,s=x&passphrase=segredo123', ['segredo123', 'u=a']],
    ['rtsps://op:SENHA1@camera.local/stream1', ['SENHA1', 'op:']],
    ['rtmpt://ingest.example.com/live/CHAVE1', ['CHAVE1']],
    ['rtmpe://ingest.example.com/live/CHAVE2', ['CHAVE2']],
    ['ftp://usuario:SENHA2@ftp.example.com/arquivos', ['SENHA2', 'usuario']],
    ['xyz+abc://u:SENHA3@host:1234', ['SENHA3']],
    ['srt://h:9000?auth_token=TOKEN1&latency=120', ['TOKEN1']],
    ['srt://h:9000?srt_passphrase=PASS1', ['PASS1']],
    ['srt://h:9000?session_token=TOKEN2', ['TOKEN2']],
    ['srt://h:9000?mypassphrase=PASS2', ['PASS2']],
    ['srt://h:9000?client_secret=SECRET1', ['SECRET1']],
    ['srt://h:9000?key=KEY1', ['KEY1']],
    ['srt://h:9000?streamid=live/STREAM1', ['STREAM1']],
    ['{"key":"KEY2","streamid":"STREAM2","streamId":"STREAM3","password":12345,"auth_token":"TOKEN3","srt_passphrase":"PASS3"}', ['KEY2', 'STREAM2', 'STREAM3', '12345', 'TOKEN3', 'PASS3']],
    ['falhou: auth_token=TOKEN4 client_secret: SECRET2', ['TOKEN4', 'SECRET2']],
  ])('%s', (raw, secrets) => {
    expect(containsCredential(raw)).toBe(true)
    const output = sanitizeDiagnostic('Entrada caiu: ' + raw)
    for (const secret of secrets) expect(output).not.toContain(secret)
    expect(containsCredential(output)).toBe(false)
  })
  it('estrutura: nomes novos mascarados (auth_token, srt_passphrase, streamId, key, número)', () => {
    const result = diagnosticValue({ auth_token: 'A', srt_passphrase: 'B', streamId: 'C', key: 'D', password: 12345, nested: { clientSecret: 'E' }, latency: 120 })
    expect(result).toEqual({ auth_token: 'REDACTED', srt_passphrase: 'REDACTED', streamId: 'REDACTED', key: 'REDACTED', password: 'REDACTED', nested: { clientSecret: 'REDACTED' }, latency: 120 })
    expect(containsCredential(JSON.stringify(result))).toBe(false)
  })
  it('NDI/OMT e caminhos de arquivo continuam em claro, sem reescrita', () => {
    for (const text of ['ndi:NOME (vMix - Output 1)', 'ndi://NOME (vMix - Output 1)', 'omt://192.168.0.20:6400/Estúdio 2', 'file:///D:/Vídeos/abertura.mp4', 'D:/Videos/Agroshop/abertura.mp4', 'srt://h:9000?mode=listener&latency=200'])
      expect(sanitizeDiagnostic(text)).toBe(text)
  })
})
