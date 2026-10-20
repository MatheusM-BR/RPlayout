import { useCallback, useEffect, useRef, useState } from 'react'
import type {RootCatalogReview,RootAddReview} from '@rplayout/protocol'
import { api } from '../api.js'
import {ScanCommandDialog} from './ScanCommandDialog.js'
import type { MediaRoot, ServerFolderBrowser } from '../types.js'
import {rootSelectionReady,rootListingMatches} from '../domain/root-selection.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'

interface Props {
  onMessage: (text: string) => void
  /** Recarrega o explorador quando uma pasta entra ou sai. */
  onChanged: () => void
}

/**
 * Pastas onde o acervo procura arquivo.
 *
 * Antes disto havia uma só, fixada por variável de ambiente na hora de subir:
 * trocar de pasta exigia mexer no atalho e reiniciar o sistema, e apontar para
 * duas era impossível. Numa emissora o material chega em mais de um lugar, e
 * obrigar tudo a morar sob a mesma raiz é obrigar a mover arquivo.
 */
export function PastasPanel({ onMessage, onChanged }: Props) {
  const [pastas, setPastas] = useState<MediaRoot[]>([])
  const [busy, setBusy] = useState(false)
  const [varrendo, setVarrendo] = useState(false)
  const [browser, setBrowser] = useState<ServerFolderBrowser | null>(null)
  const [browsePath, setBrowsePath] = useState('')
  const [scanDialog,setScanDialog]=useState(false)
  const [review,setReview]=useState<RootCatalogReview|null>(null),[addReview,setAddReview]=useState<RootAddReview|null>(null),[error,setError]=useState<string|null>(null)
  const live=useRef(false),epoch=useRef(0),pending=useRef(false)
  const reads=useRef(new BoundedLatestRead()),scanReads=useRef(new BoundedLatestRead())
  const [removal,setRemoval]=useState<{root:MediaRoot;review:RootCatalogReview}|null>(null)

  const recarregar = useCallback(async () => {
    const run=epoch.current,reading=await reads.current.read(signal=>api.rootCatalogReview(signal),'A consulta das pastas demorou demais. Nenhum cadastro foi enviado; confira a lista novamente.')
    if(!reading.current||!live.current||epoch.current!==run)return
    const resposta=reading.value
    setPastas(resposta.roots)
    setReview(resposta);setError(null)
  }, [])

  useEffect(() => {
    live.current=true;++epoch.current;pending.current=false;const run=epoch.current
    void recarregar().catch(cause=>{if(live.current&&epoch.current===run)setError(String(cause))})
    return()=>{live.current=false;++epoch.current;pending.current=false;reads.current.cancel();scanReads.current.cancel()}
  }, [recarregar])

  /**
   * Acompanha a varredura enquanto ela corre.
   *
   * Sem isto, apontar para uma pasta grande parecia não ter feito nada: os
   * arquivos só apareciam minutos depois, e quem estava olhando concluía que a
   * procura não funcionava.
   */
  useEffect(() => {
    if (!varrendo) return undefined
    let cancelled=false
    const relogio = window.setInterval(() => {
      void scanReads.current.read(signal=>api.scanStatus(signal),'A consulta do scanner demorou demais; conclusão não confirmada.',false)
        .then((reading) => {
          if(!reading.current||cancelled||!live.current)return
          const estado=reading.value
          if (estado.globalBusy??estado.running) return
          setVarrendo(false)
          onChanged()
          onMessage('Scanner não está mais ocupado. Confira o resultado no acervo; isso não significa aprovação da mídia.')
        })
        .catch(cause => {if(!cancelled&&live.current)setError(cause instanceof Error?cause.message:'Estado do scanner indisponível; conclusão não confirmada.')})
    }, 2_000)
    return () => {cancelled=true;window.clearInterval(relogio);scanReads.current.cancel()}
  }, [varrendo, onChanged, onMessage])

  const guard = async(acao: () => Promise<void>): Promise<void> => {
    if(pending.current)return
    pending.current=true;const run=epoch.current
    setBusy(true)
    try{await acao()}
    catch(cause){if(live.current&&epoch.current===run){setError(cause instanceof Error?cause.message:'Operação sem confirmação.');setReview(null);setAddReview(null)}}
    finally{if(live.current&&epoch.current===run){pending.current=false;setBusy(false)}}
  }

  const navegar = async (path?: string): Promise<void> => {
    const run=epoch.current
    const reading=await reads.current.read(signal=>api.browseMediaRoot(path,signal),'A navegação de pastas demorou demais. O caminho foi preservado; tente abrir novamente.')
    if(!reading.current||!live.current||epoch.current!==run)return
    const result=reading.value
    setBrowser(result)
    setAddReview(null)
    setBrowsePath(result.path)
    setError(null)
  }

  const acrescentar = (): void => {
    guard(async () => {
      const path = browsePath.trim()
      if (!path) throw new Error('Escolha uma pasta no navegador do servidor.')
      if(!addReview||!rootSelectionReady(addReview,path))throw new Error('Confira o caminho atual antes de cadastrar a pasta.')
      const run=epoch.current,result=await api.addMediaRoot(path,undefined,addReview)
      if(!live.current||epoch.current!==run)return
      const {root,scanning}=result
      setPastas(result.review.roots);setReview(result.review);setAddReview(null);setError(null)
      setVarrendo(scanning||result.scanState==='PENDING')
      onMessage(
        scanning
          ? `"${root.label}" entrou no acervo. Procurando arquivos…`
          : result.scanBatchId?`"${root.label}" entrou no acervo. Pedido ${result.scanBatchId}: ${result.scanState}. ${result.scanError??'Aguarda o scanner; registro não significa leitura concluída.'}`:`"${root.label}" entrou no acervo. ${result.scanError??'Use PROCURAR quando a sonda estiver disponível.'}`,
      )
      try{onChanged()}catch(cause){setError('Cadastro confirmado; atualização do acervo indisponível. Não repita o comando. '+String(cause))}
    })
  }

  const abrirNavegador = (): void => {
    guard(()=>navegar(browsePath||undefined))
  }

  const tirar = (pasta: MediaRoot): void => {
    if(!review||pending.current||!review.canEdit||pastas.length<2)return
    setRemoval({root:pasta,review})
  }
  const confirmarRemocao=async():Promise<void>=>{
    if(!removal||review!==removal.review||!review.canEdit||pastas.length<2)return
    const original=removal
    await guard(async () => {
      const run=epoch.current,result=await api.removeMediaRoot(original.root.id,original.review)
      if(!live.current||epoch.current!==run)return
      setPastas(result.review.roots);setReview(result.review);setAddReview(null);setError(null)
      setRemoval(null)
      onMessage(`"${original.root.label}" saiu do acervo.`)
      try{onChanged()}catch(cause){setError('Remoção confirmada; atualização do acervo indisponível. Não repita o comando. '+String(cause))}
    })
  }

  const procurar = (): void => {
    setScanDialog(true)
  }
  const conferirPasta=():void=>{void guard(async()=>{
    const run=epoch.current,reading=await reads.current.read(signal=>api.rootAddReview(browsePath,signal),'A conferência da pasta demorou demais. Nenhum cadastro foi enviado; confira novamente.')
    if(!reading.current||!live.current||epoch.current!==run)return
    const result=reading.value
    setBrowsePath(result.candidate.path);setAddReview(result);setReview(result);setPastas(result.roots);setError(null)
  })}

  return (
    <div className="field">
      <label>Pastas do acervo</label>
      {scanDialog&&<ScanCommandDialog measure={false} onClose={()=>setScanDialog(false)} onRegistered={result=>{setVarrendo(['RUNNING','PENDING'].includes(result.state));onMessage(`Pedido de procura registrado: ${result.batchId} · ${result.state}.`)}}/>}
      {!review&&<p role="status">Lista ainda não conferida; não é confirmação de acervo vazio.</p>}
      {error&&<p role="alert">{error} Campos preservados; reabra a conferência.</p>}
      <button className="btn small" disabled={busy} onClick={()=>guard(recarregar)}>CONFERIR LISTA DE PASTAS</button>
      <div className="note">
        O sistema procura arquivo em todas elas. Pasta que some da rede fica
        marcada e é pulada na procura — o acervo dela não é apagado.
      </div>

      <ul className="pastas">
        {pastas.map((pasta) => (
          <li key={pasta.id}>
            <span className="nome">{pasta.label}</span>
            <span className="caminho mono" title={pasta.path}>
              {pasta.path}
            </span>
            {!pasta.present && <span className="tag sumida">FORA DO AR</span>}
            <button
              className="btn small tira"
              disabled={busy || !review?.canEdit || pastas.length === 1}
              title={
                pastas.length === 1
                  ? 'O acervo precisa de pelo menos uma pasta.'
                  : `Tirar ${pasta.label}`
              }
              onClick={() => tirar(pasta)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {removal&&<section aria-label="Confirmação de remoção da pasta">
        <p>Tirar "{removal.root.label}" do acervo não apaga arquivos nem altera a grade.</p>
        {review!==removal.review&&<p role="alert">A conferência das pastas mudou. Cancele e escolha a pasta novamente.</p>}
        <ReviewedOperationConfirm reviewKey={JSON.stringify([removal.root.id,removal.review.revision])}
          confirmation="Autorizo retirar somente esta pasta conferida do catálogo, preservando os arquivos."
          label="Confirmar retirada da pasta" disabled={busy||review!==removal.review||!review?.canEdit||pastas.length<2} onConfirm={confirmarRemocao}/>
        <button disabled={busy} onClick={()=>setRemoval(null)}>Cancelar retirada</button>
      </section>}

      <div className="pastas-add">
        <button className="btn small" disabled={busy} onClick={abrirNavegador}>
          NAVEGAR NO SERVIDOR…
        </button>
        <button className="btn small" disabled={busy || varrendo} onClick={procurar}>
          {varrendo ? 'PROCURANDO…' : 'PROCURAR'}
        </button>
      </div>
      {browser && (
        <div className="pastas-browser" aria-label="Pastas do servidor">
          <div className="note">Navegação no servidor do playout — não abre uma janela na estação do servidor.</div>
          <div className="pastas-add">
            <button className="btn small" disabled={busy || !browser.parent} onClick={() => guard(()=>navegar(browser.parent ?? undefined))}>↑</button>
            <input disabled={busy} value={browsePath} onChange={(event) => {setBrowsePath(event.target.value);setAddReview(null)}} onKeyDown={(event) => { if (event.key === 'Enter') guard(()=>navegar(browsePath)) }} aria-label="Caminho no servidor" />
            <button className="btn small" disabled={busy} onClick={() => guard(()=>navegar(browsePath))}>ABRIR</button>
            <button className="btn small" disabled={busy||!browsePath.trim()} onClick={conferirPasta}>CONFERIR PASTA</button>
            <button className="btn small" disabled={busy||!rootSelectionReady(addReview,browsePath)} onClick={acrescentar}>USAR PASTA CONFERIDA</button>
          </div>
          <ul className="pastas">
            {!rootListingMatches(browser.path,browsePath)&&<li role="status">Caminho alterado. Clique em ABRIR para atualizar as subpastas.</li>}
            {(rootListingMatches(browser.path,browsePath)?browser.directories:[]).map((folder) => (
              <li key={folder.path}>
                <button className="btn small" disabled={busy} onClick={() => guard(()=>navegar(folder.path))}>📁 {folder.name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
