import {describe,expect,it} from 'vitest'
import {csvCell,csvRows} from './csv.js'

describe('CSV seguro para planilhas',()=>{
  it('preserva unicode, aspas, separador e quebras dentro da célula',()=>{
    expect(csvRows([['ação','João; "CÂMERA"\nOMT'],[null,25]],';')).toBe('"ação";"João; ""CÂMERA""\nOMT"\r\n"";"25"')
  })
  it('neutraliza fórmulas inclusive prefixos de espaço/tab/controle',()=>{
    for(const value of ['=SUM(A1)','+CMD','-1','@A1','  =HYPERLINK("x")','\ttexto','\rtexto','\ntexto','\u0000 =CMD'])expect(csvCell(value).startsWith('"\'')).toBe(true)
    expect(csvCell('CÂMERA-01')).toBe('"CÂMERA-01"')
  })
})
