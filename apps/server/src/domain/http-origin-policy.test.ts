import {describe,it,expect} from 'vitest'
import {parseAllowedOrigins,trustedHttpOrigin} from './http-origin-policy.js'

describe('configuração de origens é explícita e fail-closed',()=>{
  it.each([undefined,'','  '])('configuração vazia %j mantém somente a origem da página',raw=>expect(parseAllowedOrigins(raw)).toEqual([]))
  it('normaliza autoridade válida, portas padrão/IPv6, deduplica e permite slash final',()=>{
    expect(parseAllowedOrigins(' HTTP://WORKSTATION:80/ , https://workstation:443, http://[::1]:4041/, http://workstation ')).toEqual(['http://workstation','https://workstation','http://[::1]:4041'])
  })
  it.each(['null','*','https://*.example','https://%2a.example','file:///C:/IA','blob:https://host/id','ftp://host','host:4041','https://host/path','https://user:PRIVATE_ORIGIN_PASSWORD@host','https://host?token=PRIVATE_ORIGIN_TOKEN','https://host#PRIVATE_ORIGIN_FRAGMENT','https://host,','https://host,,https://other','https://ho\tst','https:\\host','https://@host'])('recusa toda a lista com entrada inválida %j sem repetir seu valor',raw=>{
    expect(()=>parseAllowedOrigins(raw)).toThrow('RPLAYOUT_ALLOWED_ORIGINS')
    try{parseAllowedOrigins(raw)}catch(error){for(const marker of ['PRIVATE_ORIGIN_PASSWORD','PRIVATE_ORIGIN_TOKEN','PRIVATE_ORIGIN_FRAGMENT'])expect((error as Error).message).not.toContain(marker)}
  })
  it('limita quantidade/tamanho sem truncar a autoridade solicitada',()=>{
    expect(()=>parseAllowedOrigins(Array(65).fill('https://host').join(','))).toThrow('64')
    expect(()=>parseAllowedOrigins('https://'+'a'.repeat(2048))).toThrow('inválida')
  })
})
describe('a requisição não amplia a configuração',()=>{
  it('sem Origin continua sujeito a sessão/papel; Origin vazio ou opaco não é ausência',()=>{
    expect(trustedHttpOrigin(undefined,'host')).toBe(true)
    expect(trustedHttpOrigin('','host')).toBe(false);expect(trustedHttpOrigin('null','host',['null'])).toBe(false)
  })
  it('autoridade própria normalizada mantém porta/IPv6, mas rejeita outro host/porta',()=>{
    expect(trustedHttpOrigin('http://workstation','WORKSTATION:80')).toBe(true)
    expect(trustedHttpOrigin('https://workstation','WORKSTATION:443')).toBe(true)
    expect(trustedHttpOrigin('http://[::1]:4041','[0:0:0:0:0:0:0:1]:4041')).toBe(true)
    for(const host of ['workstation:4041','workstation.other','user@workstation','workstation/path','work station'])expect(trustedHttpOrigin('http://workstation',host)).toBe(false)
  })
  it('origem extra precisa ser válida e exata; não libera subdomínio, porta ou URL completa',()=>{
    const extras=parseAllowedOrigins('http://localhost:5173')
    expect(trustedHttpOrigin('http://localhost:5173','server:4041',extras)).toBe(true)
    for(const origin of ['http://localhost:5174','http://localhost.other:5173'])expect(trustedHttpOrigin(origin,'server:4041',extras)).toBe(false)
    for(const origin of ['http://localhost:5173/','http://localhost:5173/path','http://user:secret@localhost:5173','HTTP://LOCALHOST:5173'])expect(trustedHttpOrigin(origin,'server:4041',[...extras,origin])).toBe(false)
  })
})
