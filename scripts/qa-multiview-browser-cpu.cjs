// Custo de decodificação no navegador: 1 mosaico 1280x720 contra 4 e 9 monitores 428x240.
// Gere mv720.webm e mon240.webm ao lado (ver docs/MULTIVIEW.md) e rode com node.
const {chromium}=require('playwright'),fs=require('fs')
const tree=root=>{const kids={};for(const p of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{const st=fs.readFileSync(`/proc/${p}/stat`,'utf8');const f=st.slice(st.lastIndexOf(')')+2).split(' ');(kids[f[1]]??=[]).push(+p)}catch{}}const out=[root];for(let i=0;i<out.length;i++)out.push(...(kids[out[i]]??[]));return out}
const ticks=pids=>pids.reduce((s,p)=>{try{const st=fs.readFileSync(`/proc/${p}/stat`,'utf8');const f=st.slice(st.lastIndexOf(')')+2).split(' ');return s+ +f[11]+ +f[12]}catch{return s}},0)
;(async()=>{
  const results=[]
  for(const [label,file,n,cols] of [['composto (1 x 1280x720)','mv720.webm',1,1],['individual 4 x 428x240','mon240.webm',4,2],['individual 9 x 428x240','mon240.webm',9,3]]){
    const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']})
    const page=await browser.newPage({viewport:{width:1280,height:720}})
    const html=`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},1fr)">${Array.from({length:n},()=>`<video src="file://${__dirname}/${file}" muted autoplay loop playsinline style="width:100%;display:block"></video>`).join('')}</body>`
    fs.writeFileSync(`${__dirname}/p.html`,html)
    await page.goto(`file://${__dirname}/p.html`)
    await page.waitForFunction(n=>[...document.querySelectorAll('video')].filter(v=>!v.paused&&v.currentTime>0.5).length===n,n,{timeout:20000})
    const pid=process.pid
    const t0=ticks(tree(pid)),at=Date.now()
    const f0=await page.evaluate(()=>[...document.querySelectorAll('video')].reduce((s,v)=>s+v.getVideoPlaybackQuality().totalVideoFrames,0))
    await page.waitForTimeout(10000)
    const f1=await page.evaluate(()=>[...document.querySelectorAll('video')].reduce((s,v)=>s+v.getVideoPlaybackQuality().totalVideoFrames,0))
    const dropped=await page.evaluate(()=>[...document.querySelectorAll('video')].reduce((s,v)=>s+v.getVideoPlaybackQuality().droppedVideoFrames,0))
    const cpu=(ticks(tree(pid))-t0)/((Date.now()-at)/1000)
    results.push({label,cpuPctOneCore:Math.round(cpu),framesPerSec:Math.round((f1-f0)/10),dropped})
    await browser.close()
  }
  console.log(JSON.stringify(results))
})()
