import {describe,expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {LiveSignalPolicyFields} from '../components/broadcast/LiveSignalPolicyFields.js'
describe('editable per-channel live warning policy',()=>{
  it('shows defaults, bounds and nonblocking scope explicitly',()=>{
    const html=renderToStaticMarkup(createElement(LiveSignalPolicyFields,{onChange:()=>{}}))
    expect(html).toContain('value="3"');expect(html).toContain('value="50"')
    expect(html).toContain('Somente aviso operacional')
    expect(html).toContain('não altera TAKE')
  })
})
