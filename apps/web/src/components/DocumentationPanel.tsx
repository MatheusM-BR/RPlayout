import { useMemo, useState } from 'react'

interface Props { onClose: () => void }

const sections = [
  ['Visão geral', 'O RPlayout é operado pela grade central. PGM mostra o que está no ar, PVW mostra o próximo material e a coluna esquerda reúne o acervo.'],
  ['Operação básica', 'Selecione um vídeo no acervo, use preparar para carregá-lo no PVW e TAKE para colocá-lo no PGM. PARAR interrompe o canal. O botão PGM FIXADO bloqueia a rolagem automática da grade.'],
  ['Acervo e pastas', 'Use + PASTA para abrir o explorador do Windows. Apenas arquivos de vídeo entram no acervo. Remover pasta retira a origem da indexação sem apagar os arquivos do disco.'],
  ['Playlists 24h', 'Abra PLAYLISTS, escolha a data, importe M3U/M3U8/CSV/TXT, revise entradas sem arquivo, ordene ou remova itens e publique no fim ou no próximo bloco. O workspace pode abrir em outra janela para não cobrir o Master.'],
  ['Assistente inteligente', 'MONTE apresenta uma proposta baseada em duração, categoria, tempo desde o último ar e preferência do operador. A proposta é explicada item a item e só altera a grade após aprovação.'],
  ['PGM, PVW e áudio', 'Os monitores começam sem áudio. Clique no ícone de alto-falante para ouvir e passe o mouse para ajustar volume. A barra vermelha abaixo do vídeo permite seek em mídias com duração; −1f e +1f avançam quadro a quadro.'],
  ['Saídas e processos', 'SAÍDAS E PROCESSOS concentra perfis RTMP/SRT/SDI, estado dos publishers, processos por canal, PID, CPU, memória e alertas. Desligue monitores que não estiverem sendo usados para reduzir consumo.'],
  ['Usuários e permissões', 'USUÁRIOS permite criar contas, escolher papel e ativar ou desativar acesso. O login é controlado por sessão; SAIR encerra a sessão atual.'],
  ['Auditoria e Aired', 'Aired registra o que entrou e saiu do ar. Auditoria permite filtrar por usuário, ação e data e exportar CSV.'],
  ['Solução de problemas', 'Se ficar em SINTONIZANDO, confira MediaMTX e o processo do canal. Se não houver áudio, clique no alto-falante e confirme se o endpoint tem trilha Opus. Se o executável fechar, use o pacote com apps/web/dist e apps/server/src preservados.'],
]

export function DocumentationPanel({ onClose }: Props) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => sections.filter(([title, body]) => `${title} ${body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query])
  return <div className="backdrop" onClick={onClose}><div className="dialog wide docs-dialog" onClick={(event) => event.stopPropagation()}>
    <header><h2>Documentação do RPlayout</h2><div className="sub">manual operacional integrado ao aplicativo</div></header>
    <div className="body"><div className="docs-toolbar"><input aria-label="buscar na documentação" placeholder="buscar funcionalidade ou procedimento" value={query} onChange={(event) => setQuery(event.target.value)} /><span className="pill ok">v1.1</span></div>
      <nav className="docs-index" aria-label="índice da documentação">{sections.map(([title]) => <a key={title} href={`#doc-${title}`} onClick={(event) => { event.preventDefault(); document.getElementById(`doc-${title}`)?.scrollIntoView({ behavior: 'smooth' }) }}>{title}</a>)}</nav>
      <div className="docs-content">{visible.map(([title, body]) => <section id={`doc-${title}`} key={title}><h3>{title}</h3><p>{body}</p></section>)}{visible.length === 0 && <div className="note">Nenhum tópico encontrado.</div>}</div>
    </div><footer><span className="note">A documentação completa também está em docs/RPLAYOUT-1.1-FUNCIONALIDADES.md.</span><button className="btn" onClick={onClose}>fechar</button></footer>
  </div></div>
}
