import { useEffect, useRef, useState } from 'react'
import type { GraphicOnAir, GraphicsReview } from '@rplayout/protocol'
import { api,type ReviewedGraphicCommand } from '../api.js'
import {GraphicTemplatesEditor} from './GraphicTemplatesEditor.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {graphicsHeaders} from '../domain/graphics-review.js'
import {graphicCommandFeedback,graphicReviewKey,graphicReviewMatches} from '../domain/graphic-command-review.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'

interface Props {
  channelId: string
  /** Arte usada como apresentação técnica, quando há uma. */
  slateTemplateId: string | null
  /** O que está no ar agora, vindo do estado ao vivo. */
  onAir: GraphicOnAir | null
  onClose: () => void
  onMessage: (text: string) => void
}

/**
 * Gerador de caracteres.
 *
 * O operador escolhe a arte, preenche os campos e põe no ar. O que sai daqui
 * é sempre o mesmo caminho: o servidor preenche o template e manda SVG pronto
 * para o engine -- não há um segundo caminho "de emergência" que se comporte
 * diferente na hora do aperto.
 */
type Intent={kind:'CLOSE'|'REOPEN'}|{kind:'REVIEW';command:ReviewedGraphicCommand}
export function GraphicsPanel(props:Props){return <GraphicsPanelContent key={props.channelId} {...props}/>}
function GraphicsPanelContent({
  channelId,
  slateTemplateId,
  onAir,
  onClose,
  onMessage,
}: Props) {
  const [slate, setSlate] = useState(slateTemplateId)
  const [review,setReview]=useState<GraphicsReview|null>(null)
  const templates=review?.templates??null
  const [chosen, setChosen] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [blocked,setBlocked]=useState(true),[error,setError]=useState(''),[showEditor,setShowEditor]=useState(false),[editorOpened,setEditorOpened]=useState(false),[editorDirty,setEditorDirty]=useState(false)
  const lock=useRef(false),generation=useRef(0),alive=useRef(true)
  const [editorBusy,setEditorBusy]=useState(false),editorLock=useRef(false)
  const [commands,setCommands]=useState<ReviewedGraphicCommand[]|null>(null),[commandError,setCommandError]=useState(''),[canReview,setCanReview]=useState(false),[reviewNote,setReviewNote]=useState('')
  const reads=useRef(new BoundedLatestRead()),commandReads=useRef(new BoundedLatestRead())
  const [intent,setIntent]=useState<Intent|null>(null),[commandLoading,setCommandLoading]=useState(false),commandPending=useRef(false)
  const current=(attempt:number)=>alive.current&&attempt===generation.current
  const commandGeneration=useRef(0)
  const loadCommands=async()=>{
    if(commandPending.current)return
    commandPending.current=true;setCommandLoading(true);setIntent(null);setReviewNote('')
    const attempt=generation.current,commandAttempt=++commandGeneration.current
    try{const reading=await commandReads.current.read(signal=>api.graphicCommands(channelId,signal),'A consulta dos comandos de grafismo demorou demais. Histórico anterior preservado; nenhuma pendência foi encerrada.');if(!reading.current)return;const result=reading.value;if(current(attempt)&&commandAttempt===commandGeneration.current){setCommands(result.commands);setCanReview(result.canReview);setCommandError('')}}
    catch(failure){if(alive.current&&attempt===generation.current&&commandAttempt===commandGeneration.current)setCommandError(failure instanceof Error?failure.message:'Não foi possível conferir comandos; histórico anterior preservado.')}
    finally{if(current(attempt)&&commandAttempt===commandGeneration.current){commandPending.current=false;setCommandLoading(false)}}
  }
  const reviewCommand=async(command:ReviewedGraphicCommand)=>{
    if(lock.current||editorLock.current||commandLoading||!graphicReviewMatches(command,commands,canReview)||!reviewNote.trim())return
    lock.current=true;setBusy(true);setIntent(null);const attempt=generation.current
    try{
      const result=await api.reviewGraphicCommand(channelId,command,reviewNote.trim());if(!current(attempt))return
      if(result.graphicCommand?.id!==command.id||result.graphicCommand.state!=='REVIEWED'||result.signalRecovered!==false||result.graphicCommand.physicalOutputValidated!==false)throw new Error('Encerramento da pendência sem recibo válido; confira o histórico.')
      let noticeFailed=false
      setReviewNote('');try{onMessage('Pendência conferida. Nenhum comando foi reenviado ou sinal declarado recuperado.')}catch{noticeFailed=true}
      await loadCommands()
      if(current(attempt)&&noticeFailed)setCommandError('Pendência gravada; atualização da tela indisponível. Não repita o comando.')
    }catch(failure){if(current(attempt))setCommandError(failure instanceof Error?failure.message:'Conferência não concluída; reabra o histórico.')}
    finally{if(current(attempt)){lock.current=false;setBusy(false)}}
  }
  const occupied=busy||editorBusy||intent!==null
  const dirty=Boolean(review&&slate!==review.slateTemplateId)||Object.values(values).some(value=>value!=='')
  const close=()=>{if(lock.current||editorLock.current)return;if(dirty||editorDirty||reviewNote.trim())setIntent({kind:'CLOSE'});else onClose()}
  const load=async()=>{
    if(lock.current||editorLock.current)return
    setIntent(null);commandReads.current.cancel();commandGeneration.current++;commandPending.current=false;setCommandLoading(false);setReviewNote('')
    lock.current=true;setBusy(true);setBlocked(true);const attempt=++generation.current
    try{const reading=await reads.current.read(signal=>api.graphicsReview(channelId,signal),'A conferência das artes demorou demais. Escolhas locais preservadas; nenhum grafismo foi enviado.');if(!reading.current)return;const result=reading.value;graphicsHeaders(result,channelId);if(current(attempt)){setReview(result);setSlate(result.slateTemplateId);setChosen(result.templates[0]?.id??'');setValues({});setEditorOpened(false);setShowEditor(false);setEditorDirty(false);setBlocked(result.channelArchived);setError(result.channelArchived?'Canal arquivado: somente consulta.':'')}}
    catch(failure){if(alive.current&&attempt===generation.current)setError(failure instanceof Error?failure.message:'Não foi possível conferir as artes; lista anterior preservada.')}
    finally{if(alive.current&&attempt===generation.current){lock.current=false;setBusy(false)}}
  }

  // Arte gravada no cadastro já entra na lista e no seletor (M8): antes era
  // preciso "Reabrir conferência" para vê-la. Só relê a conferência; não toca
  // no editor aberto nem nas escolhas locais de campos.
  const refreshAfterEdit=async()=>{
    setBlocked(true)
    try{
      const result=await api.graphicsReview(channelId);graphicsHeaders(result,channelId)
      if(!alive.current)return
      setReview(result);setSlate(current=>review&&current!==review.slateTemplateId?current:result.slateTemplateId)
      setChosen(current=>result.templates.some(row=>row.id===current)?current:result.templates[0]?.id??'')
      setBlocked(result.channelArchived);setError(result.channelArchived?'Canal arquivado: somente consulta.':'')
    }catch(failure){if(alive.current)setError((failure instanceof Error?failure.message:'Lista de artes não atualizada.')+' Clique em "Reabrir conferência das artes".')}
  }

  useEffect(() => {
    alive.current=true;setCommands(null);setCanReview(false);setReviewNote('');setCommandError('');void load()
    return () => {alive.current=false;generation.current++;commandGeneration.current++;lock.current=false;commandPending.current=false;reads.current.cancel();commandReads.current.cancel()}
  }, [channelId])

  const template = templates?.find((entry) => entry.id === chosen) ?? null

  const fire = (): void => {
    if (!template||lock.current||editorLock.current||blocked||intent) return
    const attempt=generation.current
    lock.current=true
    setBusy(true)
    api
      .showGraphic(channelId, template.id, values)
      .then(result => {if(current(attempt)){const text=graphicCommandFeedback(result.graphicCommand,template.name);try{onMessage(text)}catch{setCommandError('Comando registrado; atualização da tela indisponível. Confira o histórico antes de outra ação.')}}})
      .catch((failure: Error) => {if(current(attempt)){setCommandError(failure.message);void loadCommands()}})
      .finally(() => {if(current(attempt)){lock.current=false;setBusy(false)}})
  }

  const clear = (): void => {
    if(lock.current||editorLock.current||intent)return
    const attempt=generation.current
    lock.current=true
    setBusy(true)
    api
      .hideGraphic(channelId)
      .then(result => {if(current(attempt)){const text=graphicCommandFeedback(result.graphicCommand,'Retirada');try{onMessage(text)}catch{setCommandError('Comando registrado; atualização da tela indisponível. Confira o histórico antes de outra ação.')}}})
      .catch((failure: Error) => {if(current(attempt)){setCommandError(failure.message);void loadCommands()}})
      .finally(() => {if(current(attempt)){lock.current=false;setBusy(false)}})
  }
  const saveSlate=async()=>{
    if(lock.current||editorLock.current||blocked||!review||intent)return
    lock.current=true;setBusy(true);const attempt=generation.current
    try{const result=await api.setSlate(channelId,slate,review);if(current(attempt)){graphicsHeaders(result,channelId);if(!result.applied)throw new Error('Escolha sem confirmação de gravação. Confira antes de repetir.');setReview(result);setSlate(result.slateTemplateId);setError(result.refreshError??'');setBlocked(Boolean(result.refreshError));try{onMessage(result.refreshError?'Escolha gravada; aplicação no runtime não confirmada. Reabra antes de outra ação.':'Apresentação técnica configurada. Isso não confirma imagem no ar.')}catch{setBlocked(true);setError('Escolha gravada; atualização da tela indisponível. Não repita o comando.')}}}
    catch(failure){if(alive.current&&attempt===generation.current){setBlocked(true);setError(failure instanceof Error?failure.message:'Confira o estado antes de repetir; escolha local preservada.')}}
    finally{if(alive.current&&attempt===generation.current){lock.current=false;setBusy(false)}}
  }

  return (
    <div className="backdrop" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Gerador de caracteres" className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Gerador de caracteres</h2>
          <div className="sub">
            {onAir ? `no ar: ${onAir.name}` : 'nada no ar'} · a arte entra e sai com transição
          </div>
        </header>

        <div className="body">
          <button className="btn" disabled={busy||editorBusy||commandLoading} onClick={()=>void loadCommands()}>Conferir comandos de grafismo</button>
          {commandLoading&&<p role="status">Consultando histórico; nenhuma pendência será encerrada por esta consulta.</p>}
          {!commands&&<p>Histórico ainda não conferido; isso não confirma ausência de comandos pendentes.</p>}
          {commandError&&<div className="note warn" role="alert">{commandError}</div>}
          {commands&&<section aria-label="Histórico de comandos de grafismo">
            <div className="note">Confirmação do engine não homologa imagem física. Resultado incerto não é reenviado automaticamente.</div>
            {commands.length===0&&<div className="note">Nenhum pedido manual registrado.</div>}
            {commands.map(command=><div key={command.id} className="note">
              {new Date(command.createdAt).toLocaleString()} · {command.actor??'Operação local'} · {({ACCEPTED:'Pedido registrado',SENDING:'Envio sem conclusão',CONFIRMED:'Engine confirmou',SIMULATED:'Simulado',REJECTED:'Recusado',UNCERTAIN:'Resultado incerto',REVIEWED:'Conferido sem reenvio'})[command.state]}
              {canReview&&['ACCEPTED','SENDING','UNCERTAIN'].includes(command.state)&&<button className="btn" disabled={busy||editorBusy||commandLoading} onClick={()=>{setReviewNote('');setIntent({kind:'REVIEW',command})}}>Conferir esta pendência sem reenviar</button>}
            </div>)}
          </section>}
          <button className="btn" disabled={occupied} onClick={()=>{if(dirty||editorDirty||reviewNote.trim())setIntent({kind:'REOPEN'});else void load()}}>Reabrir conferência das artes</button>
          <button className="btn" disabled={occupied} onClick={()=>{setEditorOpened(true);setShowEditor(value=>!value)}}>{showEditor?'Ocultar cadastro':'Gerenciar artes'}</button>
          {editorOpened&&<div hidden={!showEditor}><GraphicTemplatesEditor key={channelId} channelId={channelId} disabled={busy} onMutation={()=>{void refreshAfterEdit()}} onMessage={onMessage} onDirtyChange={setEditorDirty} onBusyChange={value=>{editorLock.current=value;setEditorBusy(value)}}/></div>}
          {error&&<div className="note warn" role="alert">{error}</div>}
          {templates === null && <div className="note">Artes ainda não conferidas; falha de consulta não significa lista vazia.</div>}
          {templates?.length === 0 && (
            <div className="note warn">
              Nenhuma arte cadastrada. As três que vêm com o sistema aparecem depois que o
              servidor sobe pela primeira vez.
            </div>
          )}

          {templates && templates.length > 0 && (
            <>
              <div className="field">
                <label>Arte</label>
                <select
                  disabled={occupied||blocked}
                  value={chosen}
                  onChange={(event) => {
                    setChosen(event.target.value)
                    setValues({})
                  }}
                >
                  {templates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.holdSeconds === null ? ' · fica até tirar' : ` · ${entry.holdSeconds}s`}
                    </option>
                  ))}
                </select>
              </div>

              {template?.fields.map((field) => (
                <div className="field" key={field.key}>
                  <label>{field.label}</label>
                  <input
                    type="text"
                    disabled={occupied||blocked}
                    value={values[field.key] ?? ''}
                    placeholder={field.defaultValue || '—'}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                </div>
              ))}

              {template?.fields.length === 0 && (
                <div className="note">Esta arte não tem campo para preencher.</div>
              )}

              <label className="check">
                <input
                  type="checkbox"
                  disabled={occupied||blocked||!review}
                  checked={slate === chosen}
                  onChange={(event) => {
                    const next = event.target.checked ? chosen : null
                    setSlate(next)
                  }}
                />
                Usar como apresentação técnica — entra sozinha quando nada estiver no ar
              </label>
              <button className="btn" disabled={occupied||blocked||!dirty} onClick={()=>void saveSlate()}>Salvar apresentação técnica</button>
              <div className="note">Marcar escolhe localmente; salvar confirma a configuração conferida. Não é TAKE nem disparo de emergência.</div>

              <div className="note">
                {template?.holdSeconds === null
                  ? 'Fica no ar até alguém tirar. É o certo para selo de canal.'
                  : `Sai sozinha depois de ${template?.holdSeconds ?? 0} segundos — crédito esquecido no ar é erro clássico.`}
              </div>
            </>
          )}
        </div>

        {intent&&<section aria-label="Confirmação do painel de grafismo" className="p-3">
          {intent.kind==='REVIEW'&&<><p>Comando {intent.command.id} · {intent.command.state}. Encerrar a pendência não reenvia o comando nem declara sinal recuperado.</p><label>Observação da conferência<input value={reviewNote} maxLength={500} disabled={busy||editorBusy||commandLoading} onChange={event=>setReviewNote(event.target.value)}/></label></>}
          <ReviewedOperationConfirm reviewKey={intent.kind==='REVIEW'?graphicReviewKey(channelId,intent.command,reviewNote):JSON.stringify([channelId,review?.revision,review?.sharedRevision,generation.current,intent.kind])}
            confirmation={intent.kind==='REVIEW'?`Conferi o engine e a imagem para o comando ${intent.command.id}. Autorizo encerrar somente esta pendência, sem reenviar nem declarar sinal recuperado.`:'Autorizo descartar os campos locais, rascunhos de artes e apresentação técnica não salvos. Nada será gravado nem enviado ao ar.'}
            label={intent.kind==='REVIEW'?'Encerrar somente esta pendência':intent.kind==='REOPEN'?'Descartar escolhas e reabrir grafismo':'Descartar escolhas e fechar grafismo'}
            disabled={busy||editorBusy||intent.kind==='REVIEW'&&(commandLoading||!reviewNote.trim()||!graphicReviewMatches(intent.command,commands,canReview))}
            onConfirm={async()=>{if(intent.kind==='REVIEW')await reviewCommand(intent.command);else if(intent.kind==='REOPEN')await load();else{setIntent(null);onClose()}}}/>
          <button disabled={busy||editorBusy} onClick={()=>setIntent(null)}>Manter painel e escolhas</button>
        </section>}

        <footer>
          <button className="btn" disabled={occupied} onClick={close}>
            fechar
          </button>
          <button className="btn" disabled={occupied || !onAir} onClick={clear}>
            tirar do ar
          </button>
          <button className="btn take" disabled={occupied || blocked || !template} onClick={fire}>
            pôr no ar
          </button>
        </footer>
      </div>
    </div>
  )
}
