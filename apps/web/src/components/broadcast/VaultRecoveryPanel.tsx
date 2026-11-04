import {useCallback,useEffect,useRef,useState} from 'react'
import {api,type VaultRecoveryStatus} from '../../api.js'

const protectionLabel:Record<VaultRecoveryStatus['localProtection'],string>={
  WINDOWS_CURRENT_USER:'DPAPI do usuário Windows desta máquina',OWNER_FILE:'arquivo do usuário do servidor',ENVIRONMENT:'chave compartilhada (RPLAYOUT_VAULT_KEY)',TEST:'chave de teste',
}

/** Cartão da tela técnica. A senha só existe nos campos deste formulário e no
 * corpo do PUT; é apagada da memória do componente assim que a resposta chega. */
export function VaultRecoveryPanel(){
  const [status,setStatus]=useState<VaultRecoveryStatus|null>(null)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [open,setOpen]=useState(false)
  const [busy,setBusy]=useState(false)
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[currentPassword,setCurrentPassword]=useState('')
  const alive=useRef(true)
  const refresh=useCallback(async()=>{
    try{const value=await api.vaultRecovery();if(alive.current){setStatus(value);setError('')}}
    catch(failure){if(alive.current)setError(failure instanceof Error?failure.message:'Status do cofre indisponível.')}
  },[])
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false}},[refresh])
  const clear=()=>{setPassword('');setConfirmation('');setCurrentPassword('')}
  const submit=async()=>{
    if(!status||busy)return
    if(password!==confirmation){setError('A confirmação não confere com a nova senha.');return}
    setBusy(true);setError('');setNotice('')
    try{
      const value=await api.setVaultRecovery(status,{password,confirmation,currentPassword})
      if(!alive.current)return
      setStatus(value);setOpen(false)
      setNotice(value.fileWritten?'Senha de recuperação gravada. Os próximos backups abrem em outra máquina com ela.':'Senha gravada no banco (vai nos backups); a cópia vault-recovery.json não foi escrita.')
    }catch(failure){if(alive.current){setError(failure instanceof Error?failure.message:'Senha não confirmada.');void refresh()}}
    finally{clear();if(alive.current)setBusy(false)}
  }
  const warning=status?.warning??(status&&!status.restorableElsewhere?'Backup não restaurável em outra máquina.':null)
  return <section aria-label="Cofre e recuperação" className="rounded border border-border-subtle bg-surface-base p-3 mb-3 text-sm space-y-2">
    <h3 className="font-semibold">Cofre de credenciais</h3>
    <p className="text-xs text-outline">Só credenciais (chaves de stream, URLs de saída com senha, passphrase SRT, webhooks) ficam cifradas. Grade, auditoria e alertas estão em texto normal.</p>
    {status&&<p>Chave protegida por {protectionLabel[status.localProtection]} · {status.configured?<>senha de recuperação cadastrada{status.updatedAt?` em ${new Date(status.updatedAt).toLocaleString('pt-BR')}`:''}</>:'sem senha de recuperação'}</p>}
    {warning&&<p role="alert" className="text-on-air-crimson font-semibold">{warning}</p>}
    {status?.configured&&<p className="text-xs text-outline">Na máquina nova: restore-rplayout-backup.ps1 -RecoveryPasswordFile &lt;arquivo&gt; (ou RPLAYOUT_RECOVERY_PASSWORD). Guarde a senha fora desta máquina; sem ela e sem o vault.json original, as credenciais do backup não abrem.</p>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {!open?<button disabled={!status||busy} onClick={()=>{setOpen(true);setNotice('')}} className="border border-border-subtle rounded p-2">{status?.configured?'Trocar senha de recuperação':'Definir senha de recuperação'}</button>:
      <form className="grid gap-2 max-w-md" onSubmit={event=>{event.preventDefault();void submit()}} autoComplete="off">
        <label className="grid gap-1">Nova senha de recuperação (mín. 12 caracteres)
          <input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} className="border border-border-subtle rounded p-1 bg-surface-panel" minLength={12} required/></label>
        <label className="grid gap-1">Confirmação
          <input type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} className="border border-border-subtle rounded p-1 bg-surface-panel" minLength={12} required/></label>
        <label className="grid gap-1">Senha da sua conta (reautenticação)
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} className="border border-border-subtle rounded p-1 bg-surface-panel" required/></label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="border border-border-subtle rounded p-2">{busy?'Gravando…':'Gravar senha'}</button>
          <button type="button" disabled={busy} onClick={()=>{clear();setOpen(false)}} className="border border-border-subtle rounded p-2">Cancelar</button>
        </div>
      </form>}
  </section>
}
