import { confirmAction } from '../../domain/confirm.js'
import {useEffect,useRef,useState} from 'react'
import {api,type UpgradeBackupReport} from '../../api.js'
import {commandRequestId} from '../../domain/request-id.js'
const storage='rplayout-upgrade-backup-request-v1'
function remembered(){try{return sessionStorage.getItem(storage)??''}catch{return ''}}
export function UpgradeBackupPanel(){
  const [requestId,setRequestId]=useState(remembered),[report,setReport]=useState<UpgradeBackupReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const alive=useRef(true),pending=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const perform=async(action:'CREATE'|'QUERY'|'RECONCILE')=>{
    if(pending.current||action==='CREATE'&&requestId)return
    let id=requestId
    if(action==='CREATE'){
      try{id=commandRequestId();sessionStorage.setItem(storage,id);setRequestId(id)}catch{setError('Não foi possível guardar o pedido seguro neste navegador.');return}
    }
    if(!id)return
    if(action==='RECONCILE'&&!(await confirmAction('Encerrar apenas o pedido de um criador comprovadamente morto? Nenhum arquivo será apagado e o backup não será repetido.')))return
    pending.current=true;setBusy(true);setError('')
    try{
      const value=action==='CREATE'?await api.createUpgradeBackup(id):action==='RECONCILE'?await api.reconcileUpgradeBackup(id):await api.upgradeBackup(id)
      if(alive.current)setReport(value)
    }catch(failure){if(alive.current)setError(failure instanceof Error?failure.message:'Resultado desconhecido. Consulte o mesmo pedido; não gere outro automaticamente.')}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  return <section className="border border-border-subtle rounded p-3 my-3 space-y-2 text-sm" aria-label="Backup para atualização">
    <h3 className="font-semibold">Preparar backup para atualização</h3>
    <p>Cria uma cópia online no servidor e confere sua restauração, sem parar o PGM. Essa cópia fica fora da rotação automática. Exige administrador com acesso global.</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={busy||Boolean(requestId)} onClick={()=>void perform('CREATE')} className="border border-border-subtle rounded p-2">Criar backup de atualização</button>
      <button disabled={busy||!requestId} onClick={()=>void perform('QUERY')} className="border border-border-subtle rounded p-2">Consultar mesmo pedido</button>
      {report?.phase==='UNCERTAIN'&&<button disabled={busy} onClick={()=>void perform('RECONCILE')} className="border border-border-subtle rounded p-2">Conferir criador morto e encerrar pedido</button>}
    </div>
    {requestId&&<p className="text-xs break-all">Pedido: {requestId}</p>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<><p role="status">{report.phase} · {report.reason}</p>
      {report.file&&<p className="break-all">Arquivo no servidor: {report.file}</p>}
      {report.sha256&&<p className="text-xs break-all">SHA-256: {report.sha256}</p>}
      {report.phase==='READY'&&<p>Na nova instalação, execute prepare-rplayout-upgrade.ps1 com este backup, o cofre original e a pasta de mídia. Depois use review-rplayout-upgrade.ps1 para conferir a preparação. Ambos preservam a quarentena: não trocam o perfil nem ativam saídas ou reprodução.</p>}
      {(report.phase==='READY'||report.phase==='REFUSED')&&<button disabled={busy} onClick={()=>{try{sessionStorage.removeItem(storage)}catch{setError('Não foi possível encerrar a consulta armazenada.');return}setRequestId('');setReport(null)}} className="border border-border-subtle rounded p-2">Encerrar consulta — preservar backup</button>}
    </>}
    <p className="text-xs text-outline">Backup conferido não comprova compatibilidade da atualização, placa ou sinal. Preserve também o cofre; ele não é exportado pelo navegador.</p>
  </section>
}
