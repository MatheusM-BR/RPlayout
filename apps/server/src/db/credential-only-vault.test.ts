import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {openDatabase} from './client.js'
import {installationVault,SECRET_PREFIX} from '../domain/secret-vault.js'
import {validateDatabaseSecrets} from './vault-migration.js'
import {containsCredential} from '../domain/credential-detection.js'
import {protectedColumns,formerlyProtectedColumns,sealStoredValue,openStoredValue} from './protected-columns.js'

let directory='',savedMode:string|undefined
beforeAll(()=>{savedMode=process.env.RPLAYOUT_STORAGE_MODE;process.env.RPLAYOUT_STORAGE_MODE='INLINE';directory=mkdtempSync(join(tmpdir(),'rplayout-cofre58-'))})
afterAll(()=>{if(savedMode===undefined)delete process.env.RPLAYOUT_STORAGE_MODE;else process.env.RPLAYOUT_STORAGE_MODE=savedMode;rmSync(directory,{recursive:true,force:true})})

describe('o que é credencial',()=>{
  it.each([
    ['srt://10.0.0.5:9000?mode=caller&passphrase=segredo123',true],
    ['rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl',true],
    ['https://hooks.example.com/services/T000/B000/XXXX',true],
    ['srt://user:pw@host:9000',true],
    ['{"sources":[{"srtConfig":{"passphrase":"x"}}]}',true],
    ['{"guests":[{"streamKey":"k-1"}]}',true],
    ['{"inner":"{\\"token\\":\\"abc\\"}"}',true],
    ['Authorization: Bearer abc.def',true],
    ['ndi://ESTUDIO-3 (Câmera 1)',false],
    ['omt://192.168.0.20:6400/Estúdio 2',false],
    ['srt://10.0.0.5:9000?mode=listener&latency=200',false],
    ['udp://239.1.1.1:5000',false],
    ['D:/Videos/Agroshop/abertura.mp4',false],
    ['{"items":[{"title":"Leilão","sourceRef":"ndi://ESTUDIO"}],"srtConfig":{"passphrase":null}}',false],
    ['CPU acima de 90% por 3 amostras',false],
    // r88-37 revisão (M2): fragmento do streamid SRT, outros esquemas, nomes e JSON.
    ['srt://h:9000?mode=caller&streamid=#!::u=a,s=x&passphrase=segredo123',true],
    ['srt://h:9000?mode=caller&streamid=#!::r=live/x',true],
    ['rtsps://op:senha@camera.local/stream1',true],
    ['rtmpt://ingest.example.com/live/chave-xyz',true],
    ['rtmpe://ingest.example.com/live/chave-xyz',true],
    ['ftp://usuario:senha@ftp.example.com/arquivos',true],
    ['qualquer+coisa://u:p@host:1234',true],
    ['sftp://usuario@host/pasta',true],
    ['srt://h:9000?auth_token=t0k3n',true],
    ['srt://h:9000?srt_passphrase=segredo123',true],
    ['srt://h:9000?session_token=abc',true],
    ['srt://h:9000?mypassphrase=abc',true],
    ['srt://h:9000?client_secret=abc',true],
    ['srt://h:9000?key=abc',true],
    ['srt://h:9000?streamid=live/abc',true],
    ['udp://239.1.1.1:5000?pkt_size=1316&access_token=x',true],
    ['{"key":"abc"}',true],
    ['{"streamid":"#!::u=a"}',true],
    ['{"streamId":"live/x"}',true],
    ['{"password":12345}',true],
    ['{"srt_passphrase":"x"}',true],
    ['{"auth_token":"x"}',true],
    ['{"clientSecret":"x"}',true],
    ['{"password":null,"passphrase":"REDACTED","key":"[PROTEGIDO]"}',false],
    ['ndi:NOME (vMix - Output 1)',false],
    ['ndi://NOME (vMix - Output 1)',false],
    ['omt://192.168.0.20:6400/Estúdio 2',false],
    ['file:///D:/Videos/Agroshop/abertura.mp4',false],
    ['C:\\Videos\\Leilão\\abertura.mov',false],
    ['srt://h:9000?mode=caller&latency=200&pbkeylen=16',false],
  ])('%s → %s',(value,expected)=>{expect(containsCredential(value)).toBe(expected)})
})

describe('migração 58: cofre só para credencial',()=>{
  it('banco antigo todo cifrado: o que não é segredo vira texto; credencial, auditoria e gatilhos ficam',()=>{
    const file=join(directory,'antigo.db')
    const vault=installationVault()
    const now=new Date().toISOString()
    const seed=openDatabase(file)
    const enc=(value:string,context:string)=>vault.encrypt(value,context)
    const incident={version:1,capturedAt:now,channelId:'c',rundownId:null,revisionId:null,executionId:null,itemId:null,itemName:'Leilão',elapsedFrames:null,engine:{ready:true,processPresent:true},sources:[],outputs:[],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false}
    const passphraseSrt='srt://10.0.0.5:9000?mode=caller&passphrase=senha-forte-srt'
    seed.sqlite.transaction(()=>{
      seed.sqlite.prepare("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('c','RW',30000,1001,1920,1080,-23,-1,5,?)").run(now)
      // Formato até a r88-36: tudo envelope.
      seed.sqlite.prepare("INSERT INTO health_events(id,channel_id,component,state,severity,message,occurred_at,context) VALUES('h1','c','ENGINE','failed','ERROR',?,?,?)").run(enc('Entrada caiu: srt://10.0.0.5:9000?passphrase=REDACTED','health_events.message'),now,enc(JSON.stringify(incident),'health_events.context'))
      seed.sqlite.prepare("INSERT INTO multiview_configs(id,channel_id,layout,cells,updated_at) VALUES('m','c','GRID_2X2',?,?)").run(enc(JSON.stringify([{position:0,sourceId:'s1'}]),'multiview_configs.cells'),now)
      seed.sqlite.prepare("INSERT INTO live_sources(id,channel_id,name,kind,target_url,created_at) VALUES('ndi','c','Estúdio','NDI',?,?),('srt','c','Link','SRT',?,?)").run(enc('ndi://ESTUDIO-3 (Cam 1)','live_sources.target_url'),now,enc(passphraseSrt,'live_sources.target_url'),now)
      seed.sqlite.prepare("INSERT INTO output_profiles(id,channel_id,name,kind,target,created_at) VALUES('file','c','Gravação','FILE',?,?),('yt','c','YouTube','RTMP',?,?)").run(enc('D:/Gravacoes/pgm.ts','output_profiles.target'),now,enc('rtmp://a.rtmp.youtube.com/live2/chave-secreta','output_profiles.target'),now)
      seed.sqlite.prepare("INSERT INTO channel_project_snapshots(id,channel_id,label,payload,created_at) VALUES('p-plain','c','sem segredo',?,?),('p-key','c','com chave',?,?)").run(enc(JSON.stringify({version:1,items:[]}),'channel_project_snapshots.payload'),now,enc(JSON.stringify({version:1,guests:[{streamKey:'k-1'}]}),'channel_project_snapshots.payload'),now)
      seed.sqlite.prepare("INSERT INTO operator_decisions(id,rundown_id,item_id,kind,payload,actor_username,created_at) VALUES('d1','@http',NULL,'API_MUTATION',?,NULL,?)").run(enc(JSON.stringify({route:'/api/x'}),'operator_decisions.payload'),now)
      // Volta ao estado da r88-36: sem a migração 58.
      seed.sqlite.exec('DROP TABLE vault_recovery')
      seed.sqlite.prepare('DELETE FROM schema_migrations WHERE version=58').run()
    })()
    const triggers=seed.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
    const counters=['editorial_revision_counters','channel_configuration_versions','channel_project_versions','live_source_versions','multiview_versions'].map(table=>seed.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
    seed.sqlite.close()

    const reopened=openDatabase(file)
    try{
      const raw=(sql:string)=>(reopened.sqlite.prepare(sql).get() as {v:string}).v
      expect(raw("SELECT message v FROM health_events WHERE id='h1'")).toBe('Entrada caiu: srt://10.0.0.5:9000?passphrase=REDACTED')
      expect(JSON.parse(raw("SELECT context v FROM health_events WHERE id='h1'"))).toEqual(incident)
      expect(JSON.parse(raw("SELECT cells v FROM multiview_configs"))).toEqual([{position:0,sourceId:'s1'}])
      expect(raw("SELECT target_url v FROM live_sources WHERE id='ndi'")).toBe('ndi://ESTUDIO-3 (Cam 1)')
      expect(raw("SELECT target v FROM output_profiles WHERE id='file'")).toBe('D:/Gravacoes/pgm.ts')
      expect(JSON.parse(raw("SELECT payload v FROM channel_project_snapshots WHERE id='p-plain'"))).toEqual({version:1,items:[]})
      // Credencial continua envelope, e abre com o contexto da coluna (AAD).
      const srt=raw("SELECT target_url v FROM live_sources WHERE id='srt'"),yt=raw("SELECT target v FROM output_profiles WHERE id='yt'"),snapshot=raw("SELECT payload v FROM channel_project_snapshots WHERE id='p-key'")
      for(const value of [srt,yt,snapshot])expect(value.startsWith(SECRET_PREFIX)).toBe(true)
      expect(openStoredValue(srt,'live_sources.target_url')).toBe(passphraseSrt)
      expect(()=>vault.decrypt(srt,'output_profiles.target')).toThrow()
      // Auditoria append-only não é reescrita.
      expect(raw("SELECT payload v FROM operator_decisions WHERE id='d1'").startsWith(SECRET_PREFIX)).toBe(true)
      // Gatilhos idênticos e nenhuma revisão editorial/configuração mexida.
      expect(reopened.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).toEqual(triggers)
      expect(['editorial_revision_counters','channel_configuration_versions','channel_project_versions','live_source_versions','multiview_versions'].map(table=>reopened.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())).toEqual(counters)
      expect(reopened.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=58').get()).toEqual({name:'credential-only-vault-and-recovery'})
      expect(validateDatabaseSecrets(reopened.sqlite)).toEqual({protectedSecrets:'verified',vaultFingerprint:vault.fingerprint})
      // Credencial colada em claro direto no banco é recusada pelo verificador de backup.
      reopened.sqlite.prepare("INSERT INTO output_profiles(id,channel_id,name,kind,target,created_at) VALUES('raw','c','x','RTMP','rtmp://h/app/k',?)").run(now)
      expect(()=>validateDatabaseSecrets(reopened.sqlite)).toThrow(/credencial sem proteção/)
    }finally{reopened.sqlite.close()}
  })

  it('gravações novas: só a credencial vira envelope',()=>{
    expect(sealStoredValue('{"route":"/api/x"}','operator_decisions.payload')).toBe('{"route":"/api/x"}')
    expect(sealStoredValue('ndi://ESTUDIO','rundown_items.source_ref')).toBe('ndi://ESTUDIO')
    expect(sealStoredValue('srt://h:1?passphrase=x','rundown_items.live_endpoint').startsWith(SECRET_PREFIX)).toBe(true)
    // Chave de stream e URL de destino: sempre envelope, mesmo sem cara de segredo.
    expect(sealStoredValue('abc','guest_keys.stream_key').startsWith(SECRET_PREFIX)).toBe(true)
    expect(()=>openStoredValue('abc','guest_keys.stream_key')).toThrow()
    expect(protectedColumns.map(([t,c])=>`${t}.${c}`)).not.toContain('operator_decisions.payload')
    expect(formerlyProtectedColumns.map(([t,c])=>`${t}.${c}`)).toContain('health_events.message')
  })
})
