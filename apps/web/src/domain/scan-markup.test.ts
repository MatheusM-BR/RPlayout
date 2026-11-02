import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ScanCommandDialog} from '../components/ScanCommandDialog.js'
it('confirmação desabilitada antes de conferência; não presume leitura ou aprovação',()=>{
  const markup=renderToStaticMarkup(createElement(ScanCommandDialog,{measure:false,onClose:()=>{},onRegistered:()=>{}}))
  expect(markup).toContain('Pastas e estado ainda não conferidos');expect(markup).toMatch(/disabled=""[^>]*>Confirmar varredura conferida/);expect(markup).toContain('Não altera PGM')
})
