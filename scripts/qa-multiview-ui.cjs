// Conferência do multiview composto na tela Monitor (1920, 1366 e celular).
// Uso: RPLAYOUT_URL=http://127.0.0.1:4190 OUT=/tmp node scripts/qa-multiview-ui.cjs
// Precisa de um canal com entradas cadastradas. A porta 4190 é bloqueada
// pelo Chromium por padrão (sieve); a flag abaixo libera só ela.
const {chromium}=require('playwright')
const out=process.env.OUT??__dirname
;(async()=>{
  const browser=await chromium.launch({args:['--explicitly-allowed-ports=4190']})
  const results=[]
  for(const [label,viewport,mobile] of [['1920',{width:1920,height:1080},false],['1366',{width:1366,height:768},false],['celular',{width:390,height:844},true]]){
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1})
    const page=await context.newPage()
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto((process.env.RPLAYOUT_URL??'http://127.0.0.1:4190')+'/?workspace=monitor',{waitUntil:'networkidle'})
    const mv=page.getByTestId('composite-multiview').first()
    await mv.waitFor({timeout:15000})
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid=multiview-cell]').length===10&&!!document.querySelector('[aria-label^="PGM: abrir"]'),null,{timeout:15000})
    await mv.scrollIntoViewIfNeeded()
    const geometry=await page.evaluate(()=>{
      const stage=document.querySelector('[data-testid=multiview-stage]').getBoundingClientRect()
      const cells=[...document.querySelectorAll('[data-testid=multiview-cell]')].map(cell=>{const r=cell.getBoundingClientRect();return {label:cell.getAttribute('aria-label'),tally:cell.dataset.tally,x:r.x-stage.x,y:r.y-stage.y,w:r.width,h:r.height}})
      return {stage:{w:stage.width,h:stage.height},cells,scrollX:document.scrollingElement.scrollWidth-window.innerWidth,clock:document.querySelector('[data-testid=multiview-clock]')?.textContent}
    })
    const inside=geometry.cells.every(c=>c.x>=-1&&c.y>=-1&&c.x+c.w<=geometry.stage.w+1&&c.y+c.h<=geometry.stage.h+1)
    const ratio=geometry.stage.w/geometry.stage.h
    await page.screenshot({path:`${out}/multiview-${label}.png`,fullPage:false})
    await mv.screenshot({path:`${out}/multiview-${label}-painel.png`})
    // Escolher 3x3 mostra prévia e o botão de salvar.
    await mv.getByRole('button',{name:'3×3'}).click()
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid=multiview-cell]').length===9)
    await mv.getByRole('button',{name:'Salvar no canal'}).click()
    await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='Salvar no canal'),null,{timeout:10000})
    const saved=await page.evaluate(async()=>{const s=await (await fetch('/api/state')).json();const id=s.channels[0].id;return (await (await fetch(`/api/channels/${id}/multiview/composite`)).json()).saved})
    // Volta ao PGM/PVW+8 para a próxima resolução.
    await mv.getByRole('button',{name:'PGM/PVW + 8'}).click();await mv.getByRole('button',{name:'Salvar no canal'}).click()
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid=multiview-cell]').length===10)
    await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='Salvar no canal'),null,{timeout:10000})
    // Clique na célula abre o monitor individual.
    await mv.getByRole('button',{name:/^PGM: abrir monitor individual/}).click()
    const dialog=page.getByRole('dialog')
    await dialog.waitFor()
    const dialogText=await dialog.textContent()
    await page.screenshot({path:`${out}/multiview-${label}-monitor.png`})
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
    // Fontes individuais continua como alternativa.
    await mv.getByRole('tab',{name:'FONTES INDIVIDUAIS'}).click()
    const individual=await page.getByText('MULTIVIEW DE ENTRADAS').first().isVisible()
    await page.screenshot({path:`${out}/multiview-${label}-individual.png`})
    await page.getByRole('tab',{name:'COMPOSTO'}).first().click()
    results.push({label,stage:geometry.stage,ratio:+ratio.toFixed(3),inside,scrollX:geometry.scrollX,clock:geometry.clock,first:geometry.cells.slice(0,3).map(c=>c.label+' '+c.tally),saved3x3:saved.layout,dialog:dialogText.slice(0,90),individual,errors})
    await context.close()
  }
  await browser.close()
  console.log(JSON.stringify(results,null,1))
})().catch(e=>{console.error(e);process.exit(1)})
