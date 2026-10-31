import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {HostDistributionFence,type HostProcessIdentity} from './host-distribution-fence.js'
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
type Child=EventEmitter&{pid:number;stdin:PassThrough;stdout:PassThrough;stderr:PassThrough;exitCode:number|null;signalCode:null;killed:boolean;kill:ReturnType<typeof vi.fn>;unref:ReturnType<typeof vi.fn>}
let guard:HostDistributionFence,child:Child,sent:{version:number;nonce:string;action:string;request_id?:string}[]
const frame=(event:string,extra:Record<string,unknown>={})=>child.stdout.write(JSON.stringify({version:1,nonce:sent[0]!.nonce,event,...extra})+'\n')
const answer=(event:string,extra:Record<string,unknown>={})=>frame(event,{requestId:sent.at(-1)!.request_id,...extra})
const ready=(extra:Record<string,unknown>={})=>frame('ready',{parentPid:process.pid,guardPid:child.pid,jobBound:true,hostExclusive:true,...extra})
const proof=()=>answer('asserted',{parentPid:process.pid,guardPid:child.pid,activeProcesses:2,processPids:[process.pid,900002]})
const bindings=(pid=900002,included:boolean|null=true)=>[...([1935,8554,8888,8889,9997].map(port=>({protocol:'TCP',family:4,port,pid,included}))),{protocol:'UDP',family:4,port:8890,pid,included}]
async function admit(){const admitted=guard.acquire();ready();expect(await admitted).toBe(true)}
async function pin(){const pending=guard.pinProcess(900002,'media-generation');answer('pinned',{processToken:'media-generation'});return pending}
const ports=(identity:HostProcessIdentity,rows=bindings())=>answer('process_ports',{processToken:identity.token,bindings:rows})
beforeEach(()=>{
  sent=[];vi.mocked(spawn).mockReset()
  child=Object.assign(new EventEmitter(),{pid:900001,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,killed:false,kill:vi.fn(),unref:vi.fn()})
  child.stdin.on('data',chunk=>{for(const line of String(chunk).trim().split('\n'))sent.push(JSON.parse(line))})
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);guard=new HostDistributionFence('fixture-guard',100)
})
afterEach(()=>{guard.close();vi.useRealTimers();vi.unstubAllEnvs()})
describe('cliente privado de posse Windows, sem processos/portas reais',()=>{
  it('consulta não adquire; binário ausente não inventa proprietário nem inicia outro processo',async()=>{
    guard.close();guard=new HostDistributionFence('');expect(guard.status()).toMatchObject({blocked:true,ownedHere:false,physicalOutputValidated:false,promotionReady:false});expect(spawn).not.toHaveBeenCalled();expect(await guard.acquire()).toBe(false);expect(await guard.acquire()).toBe(false);expect(spawn).not.toHaveBeenCalled()
  })
  it('admissão exige pai/pid reais e pipe privado, broker independente sem credenciais herdadas',async()=>{
    vi.stubEnv('RPLAYOUT_ADMIN_PASSWORD','PRIVATE_PASSWORD');vi.stubEnv('RPLAYOUT_CONTROL_TOKEN','PRIVATE_TOKEN')
    await admit();expect(await guard.acquire()).toBe(true);expect(spawn).toHaveBeenCalledTimes(1)
    const call=vi.mocked(spawn).mock.calls[0]!;expect(call[1]).toEqual([]);expect(call[2]).toMatchObject({windowsHide:true,detached:true,stdio:['pipe','pipe','pipe']});expect(JSON.stringify(call)).not.toContain(sent[0]!.nonce);expect(JSON.stringify(call)).not.toContain('PRIVATE_PASSWORD');expect(JSON.stringify(call)).not.toContain('PRIVATE_TOKEN');expect(sent[0]).toEqual({version:1,nonce:expect.stringMatching(/^[a-f\d]{64}$/),action:'acquire'})
    expect(guard.status()).toMatchObject({ownedHere:true,blocked:false});for(const secret of[sent[0]!.nonce,String(process.pid),String(child.pid),'processPids'])expect(JSON.stringify(guard.status())).not.toContain(secret)
  })
  it.each([{parentPid:99},{guardPid:99},{nonce:'0'.repeat(64)},{jobBound:false},{version:2},{unexpected:true}])('recusa confirmação incorreta sem matar família: %j',async extra=>{
    const admitted=guard.acquire();ready(extra);expect(await admitted).toBe(false);expect(()=>guard.assertOwned()).toThrow('não confirmada');expect(child.kill).not.toHaveBeenCalled();expect(await guard.acquire()).toBe(false);expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('busy preserva diagnóstico, não rouba por prazo e exit não vira permissão',async()=>{
    const admitted=guard.acquire();frame('blocked',{reason:'HOST_DISTRIBUTION_BUSY'});expect(await admitted).toBe(false);child.emit('exit',0);expect(guard.status().state).toBe('BUSY');expect(await guard.acquire()).toBe(false);expect(child.kill).not.toHaveBeenCalled();expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('timeout não mata broker, não faz segundo spawn nem aceita ready tardio',async()=>{
    vi.useFakeTimers();const admitted=guard.acquire();await vi.advanceTimersByTimeAsync(101);expect(await admitted).toBe(false);ready();expect(guard.status().ownedHere).toBe(false);expect(await guard.acquire()).toBe(false);expect(spawn).toHaveBeenCalledTimes(1);expect(child.kill).not.toHaveBeenCalled()
  })
  it('falha síncrona de spawn ou error com PID não presume aquisição ou morte',async()=>{
    vi.mocked(spawn).mockImplementationOnce(()=>{throw new Error('PRIVATE_EXCEPTION')});expect(await guard.acquire()).toBe(false);guard.close();guard=new HostDistributionFence('fixture-guard',100);const admitted=guard.acquire();child.emit('error',new Error('PID_STILL_ALIVE'));expect(await admitted).toBe(false);expect(child.kill).not.toHaveBeenCalled();expect(guard.status().ownedHere).toBe(false)
  })
  it('prova fresca exige família completa, pai incluso e broker fora',async()=>{
    await admit();const pending=guard.freshProof();proof();await pending;expect(guard.status().ownedHere).toBe(true)
    const invalid=guard.freshProof(),rejected=expect(invalid).rejects.toThrow('não confirmada');answer('asserted',{parentPid:process.pid,guardPid:child.pid,activeProcesses:2,processPids:[process.pid,child.pid]});await rejected;expect(guard.status().ownedHere).toBe(false);expect(child.kill).not.toHaveBeenCalled()
  })
  it('erro sem exit e processo já terminado não retornam tentativa antiga bem-sucedida',async()=>{
    await admit();child.emit('error',new Error('IPC_FAILURE'));expect(await guard.acquire()).toBe(false);expect(()=>guard.assertOwned()).toThrow();expect(spawn).toHaveBeenCalledTimes(1);expect(child.kill).not.toHaveBeenCalled()
  })
  it('snapshot de portas exige PID do MediaMTX e pertencimento à família, não apenas API disponível',async()=>{
    await admit();const identity=await pin();let pending=guard.mediaReady(identity);ports(identity);expect(await pending).toBe(true)
    for(const value of[bindings(900003),bindings(900002,false),bindings(900002,null),bindings().filter(row=>row.port!==8890),bindings().filter(row=>row.port!==1935)]){pending=guard.mediaReady(identity);ports(identity,value);expect(await pending).toBe(false)}
    expect(guard.status().ownedHere).toBe(true);expect(await guard.mediaReady({pid:0,token:'unbound'})).toBe(false)
  })
  it('pré-configuração recusa qualquer porta alheia/inconclusiva e aceita somente recursos próprios',async()=>{
    await admit();let pending=guard.assertPortsAvailable(),rejected=expect(pending).rejects.toThrow('processo alheio');answer('ports',{bindings:bindings()});await rejected
    const identity=await pin()
    pending=guard.assertPortsAvailable(identity);ports(identity);await pending
    pending=guard.assertPortsAvailable(identity);rejected=expect(pending).rejects.toThrow('processo alheio');ports(identity,bindings(900002,null));await rejected
    pending=guard.assertPortsAvailable();answer('ports',{bindings:[]});await pending;expect(child.kill).not.toHaveBeenCalled()
  })
  it('query indisponível bloqueia prontidão sem matar ou liberar sinal existente',async()=>{
    await admit();const identity=await pin(),pending=guard.mediaReady(identity);answer('unavailable',{reason:'PROCESS_IDENTITY_UNAVAILABLE'});expect(await pending).toBe(false);expect(guard.status().ownedHere).toBe(true);const fresh=guard.freshProof();proof();await fresh;expect(child.kill).not.toHaveBeenCalled()
  })
  it('resposta antiga/expirada não satisfaz nova operação e nonce não aparece no erro',async()=>{
    await admit();vi.useFakeTimers();const first=guard.freshProof(),rejected=expect(first).rejects.toThrow('não confirmada'),id=sent.at(-1)!.request_id;await vi.advanceTimersByTimeAsync(101);await rejected
    const next=guard.freshProof();frame('asserted',{requestId:id,parentPid:process.pid,guardPid:child.pid,activeProcesses:1,processPids:[process.pid]});proof();await next;expect(guard.status().ownedHere).toBe(true)
  })
  it('resposta de operação errada, recusa de protocolo ou replay de ready cercam novas ações',async()=>{
    await admit();const pending=guard.socketBindings(),rejected=expect(pending).rejects.toThrow('não confirmada');answer('membership',{included:true});await rejected;expect(guard.status().ownedHere).toBe(false);ready();expect(guard.status().ownedHere).toBe(false);expect(child.kill).not.toHaveBeenCalled()
  })
  it('close cancela pendências e fecha pipes sem kill ou liberação antecipada de família',async()=>{
    await admit();const pending=guard.freshProof(),rejected=expect(pending).rejects.toThrow('não confirmada');guard.close();await rejected;guard.close();expect(await guard.acquire()).toBe(false);expect(child.unref).toHaveBeenCalledTimes(1);expect(child.kill).not.toHaveBeenCalled();expect(guard.status().state).toBe('CLOSED')
  })
  it('PID igual não substitui encarnação privada e liberação invalida a identidade antes do await',async()=>{
    await admit();const identity=await pin(),before=sent.length
    expect(await guard.mediaReady({...identity})).toBe(false);expect(sent).toHaveLength(before)
    const release=guard.releaseProcess(identity);expect(await guard.mediaReady(identity)).toBe(false)
    answer('process_released',{processToken:identity.token});await release
    expect(await guard.mediaReady(identity)).toBe(false);expect(child.kill).not.toHaveBeenCalled()
  })
  it('recusa confirmação de outro token sem admitir identidade por PID',async()=>{
    await admit();const pending=guard.pinProcess(900002,'original'),rejected=expect(pending).rejects.toThrow('não confirmada');answer('pinned',{processToken:'other'});await rejected;expect(guard.status().ownedHere).toBe(false);expect(child.kill).not.toHaveBeenCalled()
  })
  it('reserva token antes do await e não admite dois pins concorrentes ou novo PID na mesma geração',async()=>{
    await admit();const first=guard.pinProcess(900002,'same-generation'),before=sent.length
    await expect(guard.pinProcess(900003,'same-generation')).rejects.toThrow('não confirmada');expect(sent).toHaveLength(before)
    answer('pinned',{processToken:'same-generation'});await first
    await expect(guard.pinProcess(900003,'same-generation')).rejects.toThrow('não confirmada');expect(sent).toHaveLength(before)
  })
  it('resposta de sockets para outra geração cerca novas ações e preserva família existente',async()=>{
    await admit();const identity=await pin(),pending=guard.processBindings(identity),rejected=expect(pending).rejects.toThrow('não confirmada')
    answer('process_ports',{processToken:'other-generation',bindings:bindings()});await rejected;expect(guard.status().ownedHere).toBe(false);expect(child.kill).not.toHaveBeenCalled()
  })
  it('processo retido já terminado não é pronto mesmo que tabela de sockets mostre PID reutilizado',async()=>{
    await admit();const identity=await pin(),pending=guard.mediaReady(identity);answer('unavailable',{reason:'PROCESS_IDENTITY_UNAVAILABLE'});expect(await pending).toBe(false);expect(guard.status().ownedHere).toBe(true)
  })
  it('preserva motivo de helper anterior sem inventar código Windows e sem liberar posse',async()=>{
    await admit();const pending=guard.socketBindings(),rejected=expect(pending).rejects.toMatchObject({name:'HostNativeQueryError',diagnostic:{reason:'PORT_OWNERSHIP_UNAVAILABLE',operation:'ports'}})
    answer('unavailable',{reason:'PORT_OWNERSHIP_UNAVAILABLE'});await rejected
    expect(guard.status()).toMatchObject({ownedHere:true,promotionReady:false,nativeQueryFailure:{reason:'PORT_OWNERSHIP_UNAVAILABLE',operation:'ports'}})
    expect(guard.status().nativeQueryFailure).not.toHaveProperty('socketDiagnostic')
    const fresh=guard.freshProof();proof();await fresh;expect(guard.status().nativeQueryFailure?.operation).toBe('ports')
    const copy=guard.status().nativeQueryFailure!;copy.reason='REQUEST_TIMEOUT'
    expect(guard.status().nativeQueryFailure?.reason).toBe('PORT_OWNERSHIP_UNAVAILABLE')
    const retry=guard.socketBindings();answer('ports',{bindings:[]});expect(await retry).toEqual([])
    expect(guard.status().nativeQueryFailure).toBeNull();expect(child.kill).not.toHaveBeenCalled()
  })
  it('detalhes válidos são limitados, correlacionados e independentes da posse do host',async()=>{
    await admit();const identity=await pin(),pending=guard.processBindings(identity)
    const rejected=expect(pending).rejects.toMatchObject({diagnostic:{reason:'PORT_OWNERSHIP_UNAVAILABLE',operation:'process_ports',socketDiagnostic:{table:'TCP6',phase:'SIZE',reason:'OS_ERROR',win32Code:5}}})
    answer('unavailable',{reason:'PORT_OWNERSHIP_UNAVAILABLE',socketDiagnostic:{table:'TCP6',phase:'SIZE',reason:'OS_ERROR',win32Code:5}});await rejected
    const status=JSON.stringify(guard.status())
    for(const privateValue of[sent[0]!.nonce,identity.token,String(identity.pid),String(process.pid),'requestId'])expect(status).not.toContain(privateValue)
    expect(guard.status().ownedHere).toBe(true);expect(child.kill).not.toHaveBeenCalled()
  })
  it.each([
    {table:'TCP6',phase:'SIZE',reason:'OS_ERROR'},
    {table:'TCP6',phase:'SIZE',reason:'OS_ERROR',win32Code:-1},
    {table:'TCP6',phase:'SIZE',reason:'OS_ERROR',win32Code:4294967296},
    {table:'TCP6',phase:'SIZE',reason:'OS_ERROR',win32Code:5,privatePath:'SECRET_PATH'},
    {table:'TCP6',phase:'DECODE',reason:'LAYOUT_INVALID',win32Code:5},
  ])('rejeita metadados fora do contrato sem exibir conteúdo arbitrário: %j',async socketDiagnostic=>{
    await admit();const pending=guard.socketBindings(),rejected=expect(pending).rejects.toThrow('não confirmada')
    answer('unavailable',{reason:'PORT_OWNERSHIP_UNAVAILABLE',socketDiagnostic});await rejected
    expect(guard.status()).toMatchObject({ownedHere:false,nativeQueryFailure:null});expect(JSON.stringify(guard.status())).not.toContain('SECRET_PATH');expect(child.kill).not.toHaveBeenCalled()
  })
  it('metadados de porta em resposta de outra operação não viram diagnóstico autorizado',async()=>{
    await admit();const pending=guard.freshProof(),rejected=expect(pending).rejects.toThrow('não confirmada')
    answer('unavailable',{reason:'PORT_OWNERSHIP_UNAVAILABLE',socketDiagnostic:{table:'UDP4',phase:'READ',reason:'TABLE_CHANGED'}});await rejected
    expect(guard.status()).toMatchObject({ownedHere:false,nativeQueryFailure:null})
  })
  it('timeout fica inconclusivo e resposta atrasada não apaga a falha nem atende nova consulta',async()=>{
    vi.useFakeTimers();await admit();const pending=guard.socketBindings(),id=sent.at(-1)!.request_id
    const rejected=expect(pending).rejects.toMatchObject({diagnostic:{reason:'REQUEST_TIMEOUT',operation:'ports'}})
    await vi.advanceTimersByTimeAsync(101);await rejected
    const fresh=guard.freshProof();frame('ports',{requestId:id,bindings:[]});proof();await fresh
    expect(guard.status().nativeQueryFailure).toMatchObject({reason:'REQUEST_TIMEOUT',operation:'ports'});expect(guard.status().ownedHere).toBe(true)
  })
})
