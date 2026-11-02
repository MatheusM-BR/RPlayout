import {describe,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {sealAudit,verifyAudit} from './audit-seal.js'

const insert=(sqlite:any,id:string,scope:string,kind='USER_CREATED',at='2026-10-01T00:00:00.000Z')=>sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,item_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?,?)').run(id,scope,null,kind,'{"a":1}','admin',at)

describe('auditoria de segurança imutável',()=>{
  it('bloqueia alterar, apagar e substituir eventos de segurança, mas não os demais',()=>{
    const {sqlite}=openDatabase(':memory:')
    insert(sqlite,'s1','@security');insert(sqlite,'m1','@mirror','MIRROR_UNLOCK');insert(sqlite,'q1','@qc','CUT_MARK_ADDED');insert(sqlite,'r1','@runtime','RUNTIME')
    expect(()=>sqlite.prepare("UPDATE operator_decisions SET kind='X' WHERE id='s1'").run()).toThrow(/imutável/)
    expect(()=>sqlite.prepare("UPDATE operator_decisions SET rundown_id='@runtime' WHERE id='m1'").run()).toThrow(/imutável/)
    expect(()=>sqlite.prepare("DELETE FROM operator_decisions WHERE id='q1'").run()).toThrow(/imutável/)
    expect(()=>insert(sqlite,'s1','@security')).toThrow()
    expect(()=>sqlite.prepare("INSERT OR REPLACE INTO operator_decisions(id,rundown_id,kind,payload,created_at) VALUES('s1','@runtime','Y','{}','2026-10-01T00:00:00.000Z')").run()).toThrow(/substituída|imutável/)
    expect(()=>sqlite.prepare("UPDATE operator_decisions SET kind='RUNTIME2' WHERE id='r1'").run()).not.toThrow()
    expect(()=>sqlite.prepare("DELETE FROM operator_decisions WHERE id='r1'").run()).not.toThrow()
  })
  it('sela em cadeia e detecta adulteração feita sem os gatilhos',()=>{
    const {sqlite}=openDatabase(':memory:')
    insert(sqlite,'a','@security','LOGIN_FAILED','2026-10-01T00:00:01.000Z');insert(sqlite,'b','@security','USER_CREATED','2026-10-01T00:00:02.000Z')
    expect(sealAudit(sqlite).sealed).toBe(2)
    insert(sqlite,'c','@mirror','MIRROR_UNLOCK','2026-10-01T00:00:03.000Z')
    expect(verifyAudit(sqlite)).toMatchObject({ok:true,seals:1,sealedRows:2,unsealedRows:1})
    expect(sealAudit(sqlite).sealed).toBe(1);expect(sealAudit(sqlite).sealed).toBe(0)
    expect(verifyAudit(sqlite)).toMatchObject({ok:true,seals:2,sealedRows:3,unsealedRows:0})
    // Atacante com acesso ao arquivo remove o gatilho e edita o evento.
    sqlite.exec('DROP TRIGGER audit_immutable_update');sqlite.prepare("UPDATE operator_decisions SET actor_username='outro' WHERE id='a'").run()
    expect(verifyAudit(sqlite)).toMatchObject({ok:false,firstBrokenSeal:1,problem:expect.stringContaining('alterado')})
  })
  it('detecta evento selado apagado e selos imutáveis',()=>{
    const {sqlite}=openDatabase(':memory:')
    insert(sqlite,'a','@security');insert(sqlite,'b','@security','USER_UPDATED','2026-10-01T00:00:01.000Z');sealAudit(sqlite)
    expect(()=>sqlite.prepare('DELETE FROM audit_seals').run()).toThrow(/imutáveis/)
    sqlite.exec('DROP TRIGGER audit_immutable_delete');sqlite.prepare("DELETE FROM operator_decisions WHERE id='b'").run()
    expect(verifyAudit(sqlite)).toMatchObject({ok:false,problem:expect.stringContaining('apagado')})
  })
})
