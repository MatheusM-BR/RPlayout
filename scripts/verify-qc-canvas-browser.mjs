import {createServer} from 'node:http'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'

const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','canvas-browser-'))
const script=await build({absWorkingDir:root,bundle:true,write:false,format:'iife',platform:'browser',stdin:{resolveDir:root,contents:`
import {drawQcParade} from './apps/web/src/domain/qc-parade-draw.ts';
import {QcVectorColor} from './apps/web/src/domain/qc-vector-color.ts';
const colors=['rgba(255, 51, 75, 0.45)','rgba(0, 230, 118, 0.45)','rgba(56, 155, 255, 0.45)'];
function oldParade(ctx,p,colW,y0,range,dot){for(let y=0;y<90;y+=2)for(let x=0;x<160;x+=2)for(let c=0;c<3;c++){ctx.fillStyle=colors[c];ctx.fillRect(c*colW+x/160*colW,y0-p[(y*160+x)*4+c]/255*range,dot,dot)}}
function vector(ctx,p,optimized){const color=optimized?new QcVectorColor(ctx):null;for(let i=0;i<p.length;i+=8){const r=p[i],g=p[i+1],b=p[i+2];if(color)color.select(r,g,b);else ctx.fillStyle='rgba('+Math.max(60,r)+', '+Math.max(100,g)+', '+Math.max(120,b)+', 0.65)';ctx.fillRect(90+(-.1146*r-.3854*g+.5*b)/128*80,90-(.5*r-.4542*g-.0458*b)/128*80,1.2,1.2)}}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function time(draw){const values=[];for(let n=0;n<12;n++){const start=performance.now();draw();values.push(performance.now()-start)}values.sort((a,b)=>a-b);return {medianMs:values[6],p95Ms:values[11]}}
document.querySelector('button').onclick=async()=>{
 const results=[];for(const pattern of ['bars','noise']){const pixels=new Uint8ClampedArray(160*90*4);for(let i=0;i<pixels.length;i+=4){const x=(i/4)%160;pixels[i]=pattern==='bars'?(x<80?255:0):(i*17)%256;pixels[i+1]=pattern==='bars'?(x<80?0:255):(i*31)%256;pixels[i+2]=pattern==='bars'?0:(i*47)%256;pixels[i+3]=255}
 for(const kind of ['parade260','parade800','vector']){const width=kind==='parade800'?800:kind==='vector'?180:260,height=kind==='vector'?180:140,a=canvas(width,height),b=canvas(width,height),ca=a.getContext('2d'),cb=b.getContext('2d');
 const draw=(ctx,optimized)=>{ctx.clearRect(0,0,width,height);if(kind==='vector')vector(ctx,pixels,optimized);else (optimized?drawQcParade:oldParade)(ctx,pixels,width/3,height-10,height-20,width>400?1.8:1.2)};
 draw(ca,false);draw(cb,true);const pa=ca.getImageData(0,0,width,height).data,pb=cb.getImageData(0,0,width,height).data;let differentBytes=0;for(let i=0;i<pa.length;i++)if(pa[i]!==pb[i])differentBytes++;
 results.push({pattern,kind,differentBytes,old:time(()=>draw(ca,false)),optimized:time(()=>draw(cb,true))});document.querySelector('#canvases').append(b);
 }}
 const report={scope:'Synthetic local Canvas2D draw comparison, not end-to-end QC performance',results,pixelEquivalent:results.every(r=>r.differentBytes===0)};
 document.querySelector('pre').textContent=JSON.stringify(report,null,2);await fetch('/result',{method:'POST',body:JSON.stringify(report)});
};`}})
const html='<!doctype html><meta charset="utf-8"><title>QC Canvas comparison</title><h1>Comparação visual dos scopes</h1><button>Executar comparação</button><pre>Aguardando teste</pre><div id="canvases"></div><script>'+script.outputFiles[0].text+'</script>'
const server=createServer(async(req,res)=>{
 if(req.url==='/result'&&req.method==='POST'){
  let body='';for await(const part of req){body+=part;if(body.length>100000){res.writeHead(413);res.end();return}}
  const report=JSON.parse(body);await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2));res.end('saved');console.log(JSON.stringify({directory,...report}));return
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
console.log(JSON.stringify({directory,url:'http://127.0.0.1:'+server.address().port,expiresInMs:120000}))
setTimeout(()=>server.close(()=>process.stdin.pause()),120000).unref()
process.stdin.resume();process.stdin.once('data',()=>server.close(()=>process.stdin.pause()))
