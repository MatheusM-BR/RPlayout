import { useMemo, useState } from 'react'
import type { LibraryAsset, LibraryFolder, ScanStatus } from '../types.js'

interface Props {
  folders: LibraryFolder[]
  scan: ScanStatus | null
  onAccept: (assetId: string) => void
  onIgnore: (assetId: string) => void
  onScan: (measure: boolean) => void
}

type Verdict = 'REJEITADO' | 'ATENÇÃO' | 'APROVADO'

function verdict(asset: LibraryAsset): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = []
  if (asset.probeError) reasons.push(`Falha de análise: ${asset.probeError}`)
  if (asset.probe && asset.probe.width > 0 && asset.probe.height > 0 && asset.probe.width / asset.probe.height < 0.8) reasons.push('Formato vertical 9:16')
  if (asset.kind === 'AUDIO') reasons.push('Sem imagem')
  if (asset.probe?.hasAudio === false) reasons.push('Sem áudio')
  if (asset.ignored) return { verdict: 'REJEITADO', reasons: reasons.length ? reasons : ['Ignorado pelo operador'] }
  return reasons.length ? { verdict: 'ATENÇÃO', reasons } : { verdict: 'APROVADO', reasons: ['Mídia pronta para uso'] }
}

export function QualityControlPanel({ folders, scan, onAccept, onIgnore, onScan }: Props) {
  const [filter, setFilter] = useState<'PENDENTES' | 'TODOS' | Verdict>('PENDENTES')
  const [query, setQuery] = useState('')
  const assets = useMemo(() => folders.flatMap((folder) => folder.assets.map((asset) => ({ asset, folder: folder.name, result: verdict(asset) }))), [folders])
  const visible = assets.filter(({ asset, result }) => {
    const matchesFilter = filter === 'TODOS' || filter === 'PENDENTES' ? result.verdict !== 'APROVADO' : result.verdict === filter
    return matchesFilter && (!query || `${asset.title} ${asset.fileName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  })
  const counts = assets.reduce((value, item) => ({ ...value, [item.result.verdict]: value[item.result.verdict] + 1 }), { APROVADO: 0, ATENÇÃO: 0, REJEITADO: 0 })

  return <section className="workspace-panel qc-panel">
    <header className="workspace-panel-head">
      <div><h1>Controle de qualidade</h1><p>Revise a análise técnica antes de liberar uma mídia para a programação.</p></div>
      <div className="qc-actions"><button className="btn" disabled={scan?.running} onClick={() => onScan(false)}>VARREDURA RÁPIDA</button><button className="btn take" disabled={scan?.running} onClick={() => onScan(true)}>ANALISAR ÁUDIO E VÍDEO</button></div>
    </header>
    <div className="status-cards">
      <button className="status-card ok" onClick={() => setFilter('APROVADO')}><span>APROVADOS</span><strong>{counts.APROVADO}</strong></button>
      <button className="status-card warn" onClick={() => setFilter('ATENÇÃO')}><span>ATENÇÃO</span><strong>{counts.ATENÇÃO}</strong></button>
      <button className="status-card bad" onClick={() => setFilter('REJEITADO')}><span>REJEITADOS</span><strong>{counts.REJEITADO}</strong></button>
      <div className="status-card"><span>VARREDURA</span><strong>{scan?.running ? `${scan.seen}/${scan.total || '?'}` : 'PRONTA'}</strong></div>
    </div>
    <div className="workspace-toolbar"><input placeholder="buscar por nome do arquivo" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="PENDENTES">pendências</option><option value="TODOS">todos</option><option value="APROVADO">aprovados</option><option value="ATENÇÃO">atenção</option><option value="REJEITADO">rejeitados</option></select><span className="count-result">{visible.length} resultado(s)</span></div>
    <div className="qc-table-wrap"><table className="asrun qc-table"><thead><tr><th>mídia</th><th>pasta</th><th>formato</th><th>áudio</th><th>decisão</th><th>ação</th></tr></thead><tbody>
      {visible.map(({ asset, folder, result }) => <tr key={asset.id}>
        <td><div className="qc-media"><img src={asset.thumbnailUrl} alt="" /><div><strong>{asset.title}</strong><small>{asset.fileName}</small></div></div></td>
        <td>{folder}</td>
        <td className="mono">{asset.probe ? `${asset.probe.width}×${asset.probe.height}` : '—'}</td>
        <td><span className={`pill ${asset.probe?.hasAudio === false ? 'bad' : 'ok'}`}>{asset.probe?.hasAudio === false ? 'SEM ÁUDIO' : 'OK'}</span></td>
        <td><span className={`pill ${result.verdict === 'APROVADO' ? 'ok' : result.verdict === 'ATENÇÃO' ? 'warn' : 'bad'}`}>{result.verdict}</span><div className="qc-reasons">{result.reasons.join(' · ')}</div></td>
        <td><div className="actions">{asset.ignored ? <button className="btn small" onClick={() => onAccept(asset.id)}>ACEITAR</button> : <button className="btn small" onClick={() => onIgnore(asset.id)}>IGNORAR</button>}</div></td>
      </tr>)}
      {visible.length === 0 && <tr><td colSpan={6} className="dim">Nenhuma mídia corresponde ao filtro.</td></tr>}
    </tbody></table></div>
  </section>
}
