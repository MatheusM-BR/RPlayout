# Conferência (revisão r88-37, B2): TAKE/CUE/ABORT não se mexem quando o aviso de
# cadência aparece em 1920; em 1366/celular a faixa só existe com o aviso.
# Uso: RPLAYOUT_URL=http://127.0.0.1:4251 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/qa-master-aviso-cadencia.py <pasta-das-capturas>
# Precisa de um canal criado. publicationRequired é forçado nas respostas da API.
import json, sys, asyncio
from playwright.async_api import async_playwright
import os
URL=os.environ.get('RPLAYOUT_URL','http://127.0.0.1:4251')+'/?workspace=master'
PORT=URL.split(':')[2].split('/')[0]
OUT=sys.argv[1]
async def measure(browser, viewport, required, label):
    ctx=await browser.new_context(viewport=viewport)
    page=await ctx.new_page()
    async def patch(route):
        resp=await route.fetch()
        try: body=await resp.json()
        except Exception: return await route.fulfill(response=resp)
        def walk(v):
            if isinstance(v,dict):
                if 'publicationRequired' in v: v['publicationRequired']=required
                for x in v.values(): walk(x)
            elif isinstance(v,list):
                for x in v: walk(x)
        walk(body)
        await route.fulfill(response=resp, body=json.dumps(body), headers={**resp.headers,'content-type':'application/json'})
    await page.route('**/api/**', patch)
    await page.goto(URL, wait_until='networkidle')
    await page.wait_for_timeout(1500)
    boxes=await page.evaluate('''()=>{
      const pick=(a,b)=>[...document.querySelectorAll('button')].filter(x=>x.textContent.includes(a)&&x.textContent.includes(b)&&x.getBoundingClientRect().width>0).sort((x,y)=>x.textContent.length-y.textContent.length)[0]
      const out={}
      for(const [t,a,c] of [['TAKE','TAKE','ESPAÇO'],['CUE','CUE','F2'],['ABORT','ABORT','ABORT']]){const b=pick(a,c);if(b){const r=b.getBoundingClientRect();out[t]={x:Math.round(r.x),y:Math.round(r.y),h:Math.round(r.height)}}}
      const slot=document.querySelector('[data-testid=cadence-notice-slot]')
      out.slot=slot?{h:Math.round(slot.getBoundingClientRect().height),alert:!!slot.querySelector('[role=alert]')}:null
      return out}''')
    await page.screenshot(path=f'{OUT}/b2-{label}-{"aviso" if required else "sem-aviso"}.png')
    await ctx.close()
    return boxes
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(args=['--explicitly-allowed-ports='+PORT])
        res={}
        for label,vp in [('1920',{'width':1920,'height':1080}),('1366',{'width':1366,'height':768}),('celular',{'width':390,'height':844})]:
            res[label]={'sem':await measure(browser,vp,False,label),'com':await measure(browser,vp,True,label)}
        await browser.close()
        print(json.dumps(res,indent=1))
        wide=res['1920']
        moved=[k for k in ('TAKE','CUE','ABORT') if wide['sem'].get(k)!=wide['com'].get(k) or not wide['sem'].get(k)]
        if moved or wide['sem']['slot']['h']!=wide['com']['slot']['h']: print('FALHOU: em 1920 o aviso deslocou',moved); sys.exit(1)
        for label in ('1366','celular'):
            if res[label]['sem']['slot']['h']!=0: print('FALHOU: faixa vazia reservada em',label); sys.exit(1)
        print('OK: em 1920 TAKE/CUE/ABORT não se mexem; em 1366/celular sem faixa vazia')
asyncio.run(main())
