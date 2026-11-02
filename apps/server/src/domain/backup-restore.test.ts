import {expect,it} from 'vitest'
import {parseRestoreArguments} from './backup-restore.js'
it('aceita caminhos Unicode com espaços, preservando cada argumento',()=>{
  expect(parseRestoreArguments(['--backup','C:/Cópias São José/b.db','--destination','C:/Recuperação Çãó','--vault-file','C:/Cofre/vault.json'])).toEqual({backup:'C:/Cópias São José/b.db',destination:'C:/Recuperação Çãó',vaultFile:'C:/Cofre/vault.json'})
})
it('chave compartilhada é somente ambiente, nunca argumento',()=>{
  expect(parseRestoreArguments(['--backup','b.db','--destination','novo'])).toEqual({backup:'b.db',destination:'novo'})
})
it.each([
  [],['--backup','b.db'],['--destination','novo'],['--backup'],
  ['--backup','b.db','--destination'],['--backup','b.db','--backup','c.db','--destination','novo'],
  ['--backup','b.db','--destination','novo','--overwrite','yes'],
  ['--backup','b.db','--destination','novo','--key','SECRET'],
  ['--backup','--destination','novo'],
].map(args=>({args})))('recusa entrada incompleta, repetida ou expansão não autorizada: $args',({args})=>{expect(()=>parseRestoreArguments(args)).toThrow()})
