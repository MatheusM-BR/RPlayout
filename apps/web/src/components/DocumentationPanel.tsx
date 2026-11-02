import { useMemo, useState } from 'react'

interface Props { onClose: () => void }

const sections = [
  ['Visão geral', 'O RPlayout é operado pela grade central. PGM mostra o que está no ar, PVW mostra o próximo material e a coluna esquerda reúne o acervo.'],
  ['Aplicações independentes', 'RPlayout-Server.exe mantém o serviço 24/7 sem abrir navegador. Master, Schedule, Users, Monitor, Aired e QC são clientes independentes e podem ser fechados sem interromper o canal. Cada cliente abre diretamente no workspace correspondente.'],
  ['Operação básica', 'Selecione um vídeo no acervo, use preparar para carregá-lo no PVW e TAKE para colocá-lo no PGM. PARAR interrompe o canal. O botão PGM FIXADO mantém o item no ar na terceira posição possível e bloqueia a rolagem manual até ser liberado.'],
  ['Acervo e pastas', 'Use + PASTA para abrir o explorador do Windows. Apenas arquivos de vídeo entram no acervo. Remover pasta retira a origem da indexação sem apagar os arquivos do disco.'],
  ['Playlists 24h', 'Abra PLAYLISTS, escolha a data, importe M3U/M3U8/CSV/TXT, revise entradas sem arquivo, ordene ou remova itens e publique no fim ou no próximo bloco. O workspace pode abrir em outra janela para não cobrir o Master.'],
  ['Assistente inteligente', 'MONTE apresenta uma proposta baseada em duração, categoria, tempo desde o último ar e preferência do operador. A proposta é explicada item a item e só altera a grade após aprovação.'],
  ['PGM, PVW e áudio', 'Os monitores começam sem áudio. Clique no ícone de alto-falante para ouvir e passe o mouse para ajustar volume. A timeline abaixo do vídeo mostra tempo atual/total e envia o seek ao engine em mídias com duração; −1f e +1f avançam quadro a quadro. Fontes ao vivo aparecem como AO VIVO e não permitem seek.'],
  ['Monitoramento', 'MONITOR concentra perfis RTMP/SRT/SDI, estado dos publishers, processos por canal, PID, CPU, memória, alertas, cache e failover. Perfis são ligados e desligados imediatamente. Desligue monitores sem uso para reduzir consumo.'],
  ['Controle de qualidade', 'QC separa mídia aprovada, itens que exigem atenção e rejeitados. Arquivos 9:16, sem imagem, sem áudio, com erro de análise ou ignorados mostram o motivo e permitem aceitar, ignorar ou reprocessar.'],
  ['Usuários e permissões', 'USUÁRIOS permite criar contas, escolher papel e ativar ou desativar acesso. O login é controlado por sessão; SAIR encerra a sessão atual.'],
  ['Auditoria e Aired', 'Aired registra o que entrou e saiu do ar. Auditoria permite filtrar por usuário, ação e data e exportar CSV.'],
  ['Recuperação', 'Se ficar em SINTONIZANDO, use TENTAR NOVAMENTE no monitor e abra MONITOR para conferir processo, endpoint e MediaMTX. Se não houver áudio, ative o alto-falante e confira trilha e codec nos detalhes de áudio. Falhas de saída oferecem diagnóstico no mesmo workspace.'],
  ['Roadmap profissional', 'O RPlayout usa o XPlayout como benchmark funcional. Já há telemetria de relays, reconexão com backoff, alerta de silêncio sustentado, cobertura de 48 horas, timeline operacional e entrada SCTE normalizada. A matriz completa e os limites que dependem de hardware estão em docs/ROADMAP-XPAYOUT-BENCHMARK.md.'],
  ['Entradas e controle externo', 'DeckLink/SDI e NDI aparecem pela descoberta de fontes; SRT e RTMP podem ser informados por URL em AO VIVO. GPI, ATEM e routers usam a API protegida por RPLAYOUT_CONTROL_TOKEN e exigem gateway físico. O manual técnico está em docs/ENTRADAS-CONTROLE-EXTERNO.md.'],
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
