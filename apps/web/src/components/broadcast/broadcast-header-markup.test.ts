import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {BroadcastHeader} from './BroadcastHeader.js'

const channel={id:'c1',name:'Canal QA',rate:{num:30000,den:1001},scan:'PROGRESSIVE',height:1080,width:1920} as any
describe('B3: navegação do cabeçalho do Master',()=>{
  it('em 2xl a navegação não encolhe (nenhuma aba cortada) e quem trunca é o nome do canal',()=>{
    const html=renderToStaticMarkup(createElement(BroadcastHeader,{activeWorkspace:'master',channel,channels:[channel],onSelectChannel:()=>{},onNavigate:()=>{},sessionRole:'Administrador',authRequired:true}))
    const nav=/<nav data-testid="workspace-nav" class="([^"]+)"/.exec(html)
    expect(nav?.[1]).toContain('2xl:shrink-0')
    expect(html).toMatch(/truncate max-w-\[120px\][^"]*" title="Canal QA"/)
  })
})
