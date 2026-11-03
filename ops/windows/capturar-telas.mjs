// Abre o RPlayout num Edge sem janela, tira prints das telas e grava quadros
// do screencast para virar video. So navega (abas, configuracoes, alertas):
// nao clica em TAKE, CUE, ABORT nem em nada da grade.
import {spawn} from 'node:child_process'
import {mkdirSync,writeFileSync,rmSync,appendFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const out='D:\\IA\\Claude\\RPlayout\\telas', frames=join(out,'quadros'), logf=join(out,'captura.log')
rmSync(out,{recursive:true,force:true}); mkdirSync(frames,{recursive:true})
const log=m=>appendFileSync(logf,new Date().toISOString()+' '+m+'\n')
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const edgeCandidates=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
const port=9333, profile=join(tmpdir(),'rplayout-captura-'+Date.now())
let edge
for(const p of edgeCandidates){ try{ edge=spawn(p,['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--window-size=1920,1080','--autoplay-policy=no-user-gesture-required','--mute-audio','about:blank'],{stdio:'ignore'}); log('edge '+p); break }catch(e){ log('edge falhou '+p+' '+e) } }
if(typeof WebSocket==='undefined'){ log('ERRO: node sem WebSocket global'); process.exit(1) }
let target
for(let i=0;i<40&&!target;i++){ try{ const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target=list.find(t=>t.type==='page') }catch{}; if(!target)await sleep(500) }
if(!target){ log('ERRO: Edge sem DevTools'); edge?.kill(); process.exit(1) }
const ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
let seq=0; const pending=new Map(); let recording=false, frameNo=0; const frameTimes=[]
ws.onmessage=ev=>{ const m=JSON.parse(ev.data)
  if(m.id&&pending.has(m.id)){ const {res,rej}=pending.get(m.id); pending.delete(m.id); m.error?rej(new Error(JSON.stringify(m.error))):res(m.result); return }
  if(m.method==='Page.screencastFrame'){ send('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{})
    if(recording){ const n=String(++frameNo).padStart(5,'0'); writeFileSync(join(frames,`f${n}.jpg`),Buffer.from(m.params.data,'base64')); frameTimes.push([n,m.params.metadata.timestamp]) } }
}
const send=(method,params={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method,params}))})
const evaluate=async expr=>(await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true})).result?.value
await send('Page.enable'); await send('Runtime.enable')
async function viewport(w,h,mobile=false){ await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile}) }
async function shot(name){ const r=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,name+'.png'),Buffer.from(r.data,'base64')); log('print '+name) }
const clickNav=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('nav button, nav a')].find(e=>e.textContent.trim().toUpperCase()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`)
const clickTitle=t=>evaluate(`(()=>{const b=document.querySelector('[title=${JSON.stringify(t)}]');if(!b)return false;b.click();return true})()`)
async function esc(){ for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27}) }
async function smoothScroll(selectorHint){ for(let i=0;i<6;i++){ await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:600,deltaX:0,deltaY:300}); await sleep(400) } for(let i=0;i<6;i++){ await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:600,deltaX:0,deltaY:-300}); await sleep(250) } }

await viewport(1920,1080)
await send('Page.navigate',{url:'http://127.0.0.1:4000/'}); await sleep(9000)
await send('Page.startScreencast',{format:'jpeg',quality:80,maxWidth:1920,maxHeight:1080,everyNthFrame:1}); recording=true
await sleep(4000); await shot('01-master-1920')
const telas=[['PLAYLIST','02-playlist'],['QC','03-qc'],['MONITOR','04-monitor'],['AIRED','05-aired'],['DOCS','06-docs']]
for(const [label,name] of telas){ const ok=await clickNav(label); log(label+' '+ok); await sleep(4500); await shot(name+'-1920'); if(label==='PLAYLIST'||label==='AIRED')await smoothScroll() }
await clickNav('MASTER'); await sleep(3000)
if(await clickTitle('Problemas e Alertas da Sessão')){ await sleep(2500); await shot('07-alertas'); await esc(); await sleep(1200) }
if(await clickTitle('Configurações e Canais')){ await sleep(3000); await shot('08-configuracoes'); await esc(); await sleep(1500) }
await clickNav('MASTER'); await sleep(3000)
recording=false; await send('Page.stopScreencast')
await viewport(1366,768); await sleep(3500); await shot('09-master-1366')
await clickNav('MONITOR'); await sleep(3500); await shot('10-monitor-1366')
await clickNav('QC'); await sleep(3500); await shot('11-qc-1366')
await viewport(390,844,true); await send('Page.reload'); await sleep(8000); await shot('12-celular')
writeFileSync(join(out,'quadros.txt'),frameTimes.map(([n,t])=>`${n} ${t}`).join('\n'))
log('quadros '+frameNo); ws.close(); edge?.kill(); log('FIM')
process.exit(0)
