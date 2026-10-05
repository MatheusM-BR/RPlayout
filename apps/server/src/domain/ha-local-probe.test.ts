import {fileURLToPath} from 'node:url'
import {mkdtemp,writeFile,symlink,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {assessLocalProbe,probeRuntimeHash,runLocalProbe} from './ha-local-probe.js'
import {DEFAULT_QC_PROFILE,type MediaAsset} from '@rplayout/protocol'
const script=fileURLToPath(new URL('./ha-local-probe.fixture.mjs',import.meta.url))
const asset={id:'asset',contentHash:'a'.repeat(64),kind:'VIDEO',title:'Teste',path:'not used',durationFrames:25,durationNs:1e9,createdAt:new Date().toISOString()} as MediaAsset
const proof={ok:true,durationNs:1e9,decodedVideoBuffers:25,decodedAudioBuffers:0,videoCodec:'video/x-h264',video:{width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive'}}
afterEach(()=>vi.unstubAllEnvs())
describe('sonda local HA: subprocesso limitado e evidência independente',()=>{
  it('executa filho próprio, espera fechamento e não herda credenciais RPlayout',async()=>{
    vi.stubEnv('HA_LOCAL_PROBE_TEST_CASE','good');vi.stubEnv('RPLAYOUT_ADMIN_PASSWORD','DUMMY_PRIVATE');vi.stubEnv('RPLAYOUT_VAULT_FILE','DUMMY_VAULT');vi.stubEnv('rplayout_private','DUMMY')
    const output=await runLocalProbe(process.execPath,script,new AbortController().signal) as typeof proof
    expect(output.videoCodec).toBe('video/x-h264')
    expect(()=>process.kill(output.decodedVideoBuffers,0)).toThrow() // Fixture encodes its PID, not a frame count.
  })
  it.each(['invalid','nonzero','overflow'])('recusa resposta %s sem divulgar stderr/caminhos privados',async mode=>{
    vi.stubEnv('HA_LOCAL_PROBE_TEST_CASE',mode)
    await expect(runLocalProbe(process.execPath,script,new AbortController().signal)).rejects.toThrow(/sonda local/i)
  })
  it('limite de tempo encerra somente o filho da análise',async()=>{
    vi.stubEnv('HA_LOCAL_PROBE_TEST_CASE','hang')
    await expect(runLocalProbe(process.execPath,script,new AbortController().signal,200)).rejects.toThrow('limite de tempo')
  })
  it('cancelamento prévio não abre processo e cancelamento em curso aguarda close',async()=>{
    vi.stubEnv('HA_LOCAL_PROBE_TEST_CASE','hang')
    const first=new AbortController();first.abort()
    await expect(runLocalProbe(process.execPath,script,first.signal)).rejects.toThrow('cancelada')
    const controller=new AbortController(),work=runLocalProbe(process.execPath,script,controller.signal)
    setTimeout(()=>controller.abort(),200)
    await expect(work).rejects.toThrow('cancelada')
  })
  it('registra SHA do executável e recusa link ou arquivo ausente',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'RPlayout-local-probe-unit-')),file=join(directory,'runtime.exe'),link=join(directory,'link.exe')
    const target=join(directory,'target');await mkdir(target)
    await writeFile(file,'unit-runtime');await symlink(target,link,'junction')
    expect(await probeRuntimeHash(file)).toBe(createHash('sha256').update('unit-runtime').digest('hex'))
    await expect(probeRuntimeHash(link)).rejects.toThrow('inválido');await expect(probeRuntimeHash(join(directory,'absent'))).rejects.toThrow()
  })
  it('não aceita caps/ok:true sem buffers nem metadados legados como prova local',()=>{
    expect(assessLocalProbe(asset,{...proof,decodedVideoBuffers:0},undefined,'now')).toMatchObject({decoded:false,checks:{playable:false}})
    const legacy={...proof} as any;delete legacy.decodedVideoBuffers
    expect(assessLocalProbe({...asset,probe:proof.video as any},legacy,undefined,'now')).toMatchObject({decoded:false,probe:null,checks:{playable:false}})
  })
  it('perfil local exige codec, cadência, geometria, áudio e loudness reais',()=>{
    const result=assessLocalProbe({...asset,loudnessFile:{integratedLufs:-23,lra:1,truePeakDbtp:-2,scope:'FILE',measuredAt:'old'}},proof,{...DEFAULT_QC_PROFILE,codecs:['video/x-h265'],width:1920,height:1080,fps:29.97,requireAudio:true,requireLoudness:true},'now')
    expect(result.decoded).toBe(true);expect(result.checks.playable).toBe(false);expect(result.checks.errors).toHaveLength(6);expect(result.loudnessFile).toBeNull()
  })
  it('requer buffers da trilha de áudio anunciada e medição completa para QC R128',()=>{
    const audio={rate:48000,channels:2,integratedLufs:-23,lra:1,truePeakDbtp:-2}
    expect(assessLocalProbe(asset,{...proof,audio},undefined,'now').decoded).toBe(false)
    const result=assessLocalProbe(asset,{...proof,audio,decodedAudioBuffers:10},{...DEFAULT_QC_PROFILE,requireAudio:true,requireLoudness:true},'now')
    expect(result).toMatchObject({decoded:true,checks:{playable:true},loudnessFile:{integratedLufs:-23,scope:'FILE',measuredAt:'now'}})
  })
})
