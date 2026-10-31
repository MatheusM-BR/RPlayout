import { describe, expect, it } from 'vitest'
import { DiagnosticLines, sanitizeDiagnostic, diagnosticValue } from './sanitize-diagnostic.js'

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
})
