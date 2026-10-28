import { confirmAction } from '../domain/confirm.js'
import {useEffect,useRef,useState} from 'react'
import type {AccountCatalogReview,AccountSessionsReview,ReviewedAccount} from '@rplayout/protocol'
import {api} from '../api.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'

const roles:Record<string,string>={OPERATOR:'Operador',PROGRAMMER:'Programador',SUPERVISOR:'Supervisor',ADMIN:'Administrador'}
const roleName=(role:string)=>Object.hasOwn(roles,role)?roles[role]:`Papel inválido: ${role}`
type Editor={kind:'PROFILE'|'ACCESS';review:AccountCatalogReview;user:ReviewedAccount}
const inputClass='bg-surface-panel border border-border-subtle p-2 rounded text-on-surface'
const buttonClass='px-3 py-2 border border-border-subtle rounded disabled:opacity-50'

export function UsersPanel({onMessage}:{onMessage:(text:string)=>void}) {
  const [view,setView]=useState<AccountCatalogReview|null>(null),[createReview,setCreateReview]=useState<AccountCatalogReview|null>(null)
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('OPERATOR')
  const [editor,setEditor]=useState<Editor|null>(null),[sessionReview,setSessionReview]=useState<AccountSessionsReview|null>(null)
  const [editRole,setEditRole]=useState('OPERATOR'),[enabled,setEnabled]=useState(true),[newPassword,setNewPassword]=useState('')
  const [allowedChannels,setAllowedChannels]=useState<string[]|null>(null),[restrictedStations,setRestrictedStations]=useState(false),[stationIps,setStationIps]=useState('')
  const [channels,setChannels]=useState<Awaited<ReturnType<typeof api.state>>['channels']>([])
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(true),[error,setError]=useState('')
  const alive=useRef(true),generation=useRef(0),busyRef=useRef(false)
  const reads=useRef(new BoundedLatestRead())
  const dirty=Boolean(username||password||role!=='OPERATOR'),createStale=Boolean(view&&createReview&&view.revision!==createReview.revision)
  const disabled=busy||blocked||!view
  const current=(id:number)=>alive.current&&generation.current===id
  const start=()=>{if(busyRef.current)return null;busyRef.current=true;setBusy(true);return generation.current}
  const finish=(id:number)=>{if(current(id)){busyRef.current=false;setBusy(false)}}
  const failure=(id:number,cause:unknown)=>{if(current(id)){setBlocked(true);const message=cause instanceof Error?cause.message:'Não foi possível conferir as contas.';setError(message);onMessage(message)}}
  const resetDrafts=()=>{setEditor(null);setSessionReview(null);setUsername('');setPassword('');setRole('OPERATOR');setNewPassword('')}
  const load=async(confirm:boolean)=>{
    if(busyRef.current)return
    if(confirm&&(dirty||editor||sessionReview)&&!(await confirmAction('Reabrir descarta os rascunhos e conferências atuais. Continuar?')))return
    const id=start();if(id===null)return
    const reading=reads.current.start()!
    try {
      const [review,state]=await Promise.all([api.users(reading.signal),api.state(reading.signal)])
      if(!current(id)||!reading.isCurrent())return
      setView(review);setCreateReview(review);setChannels(state.channels);resetDrafts();setError('');setBlocked(false)
    }catch(cause){
      const timedOut=reading.timedOut()
      if(reading.isCurrent())reads.current.cancel() // drain sibling GET, never writes
      failure(id,timedOut?new Error('A consulta de contas demorou demais. Nenhuma alteração foi enviada; reabra a conferência para tentar novamente.'):cause)
    }finally{reading.finish();finish(id)}
  }
  useEffect(()=>{
    alive.current=true;generation.current++;busyRef.current=false;void load(false)
    return ()=>{alive.current=false;generation.current++;busyRef.current=false;reads.current.cancel()}
  },[])
  const accepted=(result:AccountCatalogReview&{requiresLogin:boolean},id:number)=>{
    if(!current(id))return
    setView(result);if(!dirty)setCreateReview(result)
    setEditor(null);setNewPassword('');setError('')
    if(result.requiresLogin){setBlocked(true);window.dispatchEvent(new Event('rplayout-session-ended'));onMessage('Alteração gravada. Entre novamente para continuar.')}else onMessage('Alteração gravada e sessões da conta encerradas quando aplicável.')
  }
  const add=async()=>{
    if(disabled||!createReview||createStale||editor||sessionReview)return
    const id=start();if(id===null)return
    try {
      const result=await api.addUser({username,password,role:createReview.bootstrapAllowed?'ADMIN':role},createReview)
      if(!current(id))return
      resetDrafts();setCreateReview(result);accepted(result,id)
    }catch(cause){failure(id,cause)}finally{finish(id)}
  }
  const edit=(user:ReviewedAccount,kind:Editor['kind'])=>{
    if(disabled||!view||editor||sessionReview)return
    setEditor({kind,user,review:view});setEditRole(user.role);setEnabled(user.enabled);setNewPassword('')
    setAllowedChannels(user.channelIds);setRestrictedStations(user.stationIps!==null);setStationIps(user.stationIps?.join(', ')??'')
  }
  const save=async()=>{
    if(disabled||!editor)return
    const draft=editor,id=start();if(id===null)return
    try {
      const result=draft.kind==='PROFILE'
        ?await api.patchUser(draft.user.id,{role:editRole,enabled,...(newPassword?{password:newPassword}:{})},draft.review)
        :await api.userAccess(draft.user.id,{channelIds:allowedChannels,stationIps:restrictedStations?stationIps.split(/[\s,;]+/).filter(Boolean):null},draft.review)
      accepted(result,id)
    }catch(cause){failure(id,cause)}finally{finish(id)}
  }
  const inspectSessions=async(user:ReviewedAccount)=>{
    if(disabled||editor||sessionReview)return
    const id=start();if(id===null)return
    const reading=reads.current.start()!
    try {
      const review=await api.userSessions(user.id,reading.signal)
      if(current(id)&&reading.isCurrent())setSessionReview(review)
    }catch(cause){
      const timedOut=reading.timedOut()
      if(reading.isCurrent())reads.current.cancel()
      failure(id,timedOut?new Error('A consulta de sessões demorou demais. Nenhuma sessão foi encerrada; reabra a conferência para tentar novamente.'):cause)
    }finally{reading.finish();finish(id)}
  }
  const revoke=async()=>{
    if(disabled||!sessionReview)return
    const draft=sessionReview,id=start();if(id===null)return
    try {
      const result=await api.revokeUserSessions(draft.userId,draft)
      if(!current(id))return
      setSessionReview(null);setError('')
      if(result.requiresLogin){setBlocked(true);window.dispatchEvent(new Event('rplayout-session-ended'))}
      onMessage(`${result.revokedCount} registro(s) de sessão encerrado(s). A conta foi preservada.${result.requiresLogin?' Entre novamente.':''}`)
    }catch(cause){failure(id,cause)}finally{finish(id)}
  }
  const cancel=async()=>{if(busyRef.current)return;if(editor&&!(await confirmAction('Descartar os campos desta edição de conta?')))return;setEditor(null);setSessionReview(null);setNewPassword('')}
  return <section className="p-4 flex flex-col gap-4 bg-surface-card rounded border border-border-subtle text-on-surface">
    <header className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">Usuários e acesso</h2><button className={buttonClass} disabled={busy} onClick={()=>void load(true)}>Reabrir conferência das contas</button></header>
    <p className="text-sm text-outline">Editar e marcar não grava automaticamente. Salvar exige a conferência original; mudanças em outra estação são recusadas. Senhas e tokens nunca são exibidos na consulta.</p>
    {error&&<p role="alert" className="text-armed-amber">{error} Campos e lista anteriores preservados. Reabra explicitamente antes de gravar.</p>}
    {!view&&<p role="status">{busy?'Conferindo contas…':'Contas não conferidas. Não é confirmação de catálogo vazio.'}</p>}
    {view&&<>
      <p>{view.users.length} conta(s) na conferência.</p>
      {view.users.length===0&&<p>{view.bootstrapAllowed?'Nenhuma conta cadastrada nesta conferência. A primeira conta será Administrador.':'Primeira conta indisponível nesta estação. Abra a página local do servidor ou entre com o administrador configurado.'}</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Usuário</th><th>Papel / situação</th><th>Acesso</th><th>Ações</th></tr></thead><tbody>{view.users.map(user=><tr key={user.id} className="border-t border-border-subtle"><td className="py-3">{user.username}</td><td>{roleName(user.role)} · {user.enabled?'Ativo':'Inativo'}</td><td>{user.channelIds===null?'Todos os canais':`${user.channelIds.length} canal(is)`} · {user.stationIps===null?'Todas as estações':`${user.stationIps.length} estação(ões)`}</td><td className="flex flex-wrap gap-1 py-2"><button className={buttonClass} disabled={disabled||Boolean(editor||sessionReview)} onClick={()=>edit(user,'PROFILE')}>Editar conta</button><button className={buttonClass} disabled={disabled||Boolean(editor||sessionReview)} onClick={()=>edit(user,'ACCESS')}>Canais / estações</button><button className={buttonClass} disabled={disabled||Boolean(editor||sessionReview)} onClick={()=>void inspectSessions(user)}>Conferir sessões</button></td></tr>)}</tbody></table></div>
    </>}
    <fieldset disabled={disabled||Boolean(editor||sessionReview)} className="flex flex-col gap-2 border border-border-subtle rounded p-3"><legend>Nova conta</legend>
      <label className="flex flex-col">Nome de acesso<input className={inputClass} autoComplete="off" value={username} onChange={event=>setUsername(event.target.value)}/></label>
      <label className="flex flex-col">Senha provisória<input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <label className="flex flex-col">Papel<select className={inputClass} value={createReview?.bootstrapAllowed?'ADMIN':role} disabled={createReview?.bootstrapAllowed} onChange={event=>setRole(event.target.value)}>{Object.entries(roles).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {createStale&&<p role="alert">As contas mudaram após o início deste rascunho. Campos preservados; reabra a conferência para criar.</p>}
      <button className={buttonClass} disabled={!createReview?.canCreate||createStale||!username.trim()||password.length<8} onClick={()=>void add()}>Criar conta conferida</button>
    </fieldset>
    {editor&&<div role="dialog" aria-modal="true" aria-label={`Editar ${editor.user.username}`} className="border border-border-subtle rounded p-4 flex flex-col gap-3">
      <h3 className="font-bold">{editor.kind==='PROFILE'?'Conta':'Acesso'} de {editor.user.username}</h3>
      <fieldset disabled={disabled} className="flex flex-col gap-3">
        {editor.kind==='PROFILE'?<>
          <label>Papel <select className={inputClass} value={editRole} onChange={event=>setEditRole(event.target.value)}>{!Object.hasOwn(roles,editRole)&&<option value={editRole}>Papel inválido — selecione explicitamente</option>}{Object.entries(roles).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> Conta ativa</label>
          <label className="flex flex-col">Nova senha (deixe vazio para preservar)<input className={inputClass} type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)}/></label>
        </>:<>
          <label><input type="checkbox" checked={allowedChannels===null} disabled={editor.user.role==='ADMIN'&&allowedChannels===null} onChange={event=>setAllowedChannels(event.target.checked?null:[])}/> Todos os canais</label>
          {allowedChannels!==null&&channels.map(channel=><label key={channel.id}><input type="checkbox" checked={allowedChannels.includes(channel.id)} onChange={event=>setAllowedChannels(old=>event.target.checked?[...(old??[]),channel.id]:(old??[]).filter(id=>id!==channel.id))}/> {channel.name}</label>)}
          <label><input type="checkbox" checked={restrictedStations} onChange={event=>setRestrictedStations(event.target.checked)}/> Permitir somente estas estações</label>
          {restrictedStations&&<label className="flex flex-col">Endereços IP separados por vírgula<input className={inputClass} value={stationIps} onChange={event=>setStationIps(event.target.value)}/></label>}
          <p className="text-sm text-armed-amber">Lista restrita vazia bloqueia acesso. Administrador deve manter todos os canais. O último administrador acessível e sua estação atual são protegidos.</p>
        </>}
      </fieldset>
      <p className="text-sm text-outline">Salvar encerra as sessões desta conta e exige novo login. Seus campos não renovam a conferência automaticamente.</p>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={cancel}>Cancelar edição</button><button className={buttonClass} disabled={disabled||Boolean(newPassword&&newPassword.length<8)} onClick={()=>void save()}>Salvar {editor.kind==='PROFILE'?'conta':'acesso'} conferido</button></div>
    </div>}
    {sessionReview&&<div role="dialog" aria-modal="true" aria-label={`Sessões de ${sessionReview.username}`} className="border border-border-subtle rounded p-4 flex flex-col gap-3">
      <h3 className="font-bold">Sessões de {sessionReview.username}</h3><p>{sessionReview.sessions.length} registro(s), incluindo expirados. Encerrar preserva a conta. Uma sessão nova invalida esta conferência.</p>
      <ul>{sessionReview.sessions.map((session,index)=><li key={index}>Criada: {new Date(session.createdAt).toLocaleString('pt-BR')} · Expira: {new Date(session.expiresAt).toLocaleString('pt-BR')}</li>)}</ul>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={cancel}>Cancelar</button><button className={buttonClass} disabled={disabled} onClick={()=>void revoke()}>Encerrar sessões conferidas</button></div>
    </div>}
  </section>
}
