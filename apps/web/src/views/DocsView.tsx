import { useState, useMemo } from 'react'
import type { Channel } from '@rplayout/protocol'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'

interface Props {
  channel: Channel
  channels?: Channel[]
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  sessionRole?: string
  authRequired?: boolean
  onOpenSettings?: () => void
}

interface DocChapter {
  id: string
  title: string
  icon: string
  badge: string
  summary: string
  sections: {
    title: string
    tag: string
    content: string
    steps?: string[]
    note?: string
    technicalDetails?: { label: string; value: string }[]
  }[]
}

// Manual: só o que o RPlayout faz hoje. Antes havia promessas que o sistema
// não cumpre (NTP, fader, PARAR no Esc, conformidade ANCINE, -24 LUFS).
const CHAPTERS: DocChapter[] = [
  {
    id: 'visao-geral',
    title: '1. Visão geral',
    icon: 'account_tree',
    badge: 'ARQUITETURA',
    summary: 'Como o canal fica no ar 24/7 e onde ficam dados, logs e gravações.',
    sections: [
      {
        title: 'O que mantém o canal no ar',
        tag: '24/7',
        content: 'O servidor do RPlayout roda em segundo plano, sem janela. Fechar o navegador, uma janela de console ou o PowerShell não derruba o canal.',
        steps: [
          'Servidor (RPlayout-Server.exe): grade, decisões e banco SQLite. Log diário em <instalação>\\logs\\servidor-AAAA-MM-DD.log (14 dias).',
          'Engine (um processo por canal): decodifica, compõe grafismos/overlays e entrega o PGM. Se cair, o servidor reinicia e retoma.',
          'MediaMTX: distribui o PGM em RTMP/SRT/HLS e o monitor WebRTC (porta 8889) usado pelas telas.',
          'Para desligar de propósito use desligar-rplayout.ps1 (o vigia não religa); para ligar, ligar-rplayout.ps1.',
        ],
        technicalDetails: [
          { label: 'Backup do banco', value: 'Periódico + espelho em %LOCALAPPDATA%\\RPlayout\\backups-banco' },
          { label: 'Gravação do PGM', value: 'D:\\RPlayout Gravacao PGM · segmentos de 15 min · 24 h' },
          { label: 'Arquivo de mídia', value: 'D:\\RPlayout Arquivo de Midia (fora da instalação)' },
          { label: 'Atualização', value: 'Só na janela 02:00–05:00 (troca leva ~3 min)' },
        ],
      },
      {
        title: 'Telas e perfis',
        tag: 'NAVEGAÇÃO',
        content: 'O perfil (embaixo do nome do usuário) escolhe quais telas aparecem no menu desta estação. Não muda permissões: o que cada usuário pode fazer continua decidido pelo servidor.',
        steps: [
          'Operação: Master e Playlist. Padrão para usuários "Operador".',
          'Acervo: QC e Playlist.',
          'Engenharia: Master, Monitor, Aired e Configurações.',
          'Registro: Aired.',
          'Completo: todas as telas. Padrão para Supervisor e Administrador.',
        ],
      },
    ],
  },
  {
    id: 'operacao-master',
    title: '2. Operação no Master',
    icon: 'play_circle',
    badge: 'OPERAÇÃO',
    summary: 'CUE, TAKE, live com saída manual, ferramentas e atalhos.',
    sections: [
      {
        title: 'Layout',
        tag: 'MASTER',
        content: 'Faixa do ar no topo (NO AR · TAKE/CUE · PRÓXIMO), grade alta embaixo e, à direita, monitores PGM/PVW e as ferramentas em abas.',
        steps: [
          'Abas de ferramentas: Overlays 1–8, Grafismos (logo, relógio, ticker, tarja, SCTE), Inserção, Próxima grade e Contingência. A aba escolhida fica guardada na estação.',
          'A biblioteca ao lado da grade pode ser recolhida pelo ícone no cabeçalho dela; o botão BIBLIOTECA reabre.',
          'A sonda do PGM ocupa uma faixa de altura fixa no topo: alertas não empurram a tela.',
        ],
      },
      {
        title: 'Colocar no ar',
        tag: 'CUE / TAKE',
        content: 'O TAKE leva ao PGM o que está confirmado no PVW. Sem CUE, o automático segue a grade.',
        steps: [
          'CUE: clique no item da grade ou F2 (item selecionado ou o próximo). O PVW mostra o item armado.',
          'TAKE: Espaço ou o botão TAKE. "ÚLTIMO TAKE: N ms" é o tempo do comando até o servidor confirmar o item no ar (não inclui a saída RTMP/SRT/NDI).',
          'ABORT: só pelo clique, com trava e confirmação em contagem. Não há tecla para parar o canal.',
          'LIMPAR CUE / PVW: desfaz o CUE sem mexer no PGM.',
          'Live com saída manual: a estimativa não dispara TAKE. Passado o tempo, o card mostra EXCEDIDO +tempo e o PRÓXIMO, ATRASADO. Ajuste com os botões ±5/30/60 s.',
        ],
        note: 'Atalhos: Espaço = TAKE · F2 = CUE · Ctrl+Z / Ctrl+Y = desfazer / refazer edição da grade · Delete = remover itens selecionados (com confirmação) · Esc = fechar diálogo.',
      },
    ],
  },
  {
    id: 'playlists-24h',
    title: '3. Playlist',
    icon: 'calendar_month',
    badge: 'PROGRAMAÇÃO',
    summary: 'Grade no ar x grade em edição, publicação, loop e lacunas.',
    sections: [
      {
        title: 'Editar e publicar',
        tag: 'GRADE',
        content: 'O selo NO AR mostra a grade que está saindo. Quando a tela mostra outra data, aparece EDITANDO OUTRA GRADE: mudanças só vão ao ar depois de PUBLICAR REVISÃO.',
        steps: [
          'Grade em loop aparece como o primeiro ciclo + "repete mais N× até HH:MM:SS"; o botão mostra todas as linhas.',
          'LACUNA na linha do tempo = período sem programação. Clique para preencher (Auto-Fill) ou insira itens.',
          'Importar BXF / M3U traz listas externas; Revisões mostra o histórico publicado.',
          'Status por linha: QC OK, QC PEND., QC RESSALVA, REJEITADO, BLOQUEADO, INDISPONÍVEL (arquivo ausente ou ignorado) e AO VIVO.',
        ],
      },
    ],
  },
  {
    id: 'qc-acervo',
    title: '4. QC e acervo',
    icon: 'verified',
    badge: 'QUALIDADE',
    summary: 'Varredura, loudness, aprovação e perfil técnico.',
    sections: [
      {
        title: 'Varredura e loudness',
        tag: 'INGEST',
        content: 'ESCANEAR INGEST lê as pastas do acervo. MEDIR LOUDNESS mede EBU R128 (integrado, true peak, LRA) dos arquivos ainda sem medição; os já medidos são pulados.',
        steps: [
          'Sem loudness medida, o nivelamento automático do PGM não tem referência. O topo do QC mostra "N SEM LOUDNESS"; clique para medir.',
          'A medição decodifica o arquivo inteiro e usa CPU: prefira fora de horário crítico.',
          'Alvo e teto vêm do canal (Configurações › Canais): padrão −23 LUFS e −1 dBTP.',
        ],
      },
      {
        title: 'Aprovar, ressalvar, rejeitar',
        tag: 'DECISÃO',
        content: 'O perfil técnico define o que precisa estar identificado (codec, geometria, cadência, varredura, duração, áudio). Material reprovado ou bloqueado não vai ao PGM.',
        steps: [
          'Aprovar libera o arquivo para a grade (só aparece em itens pendentes ou com alerta). Rejeitar reprova o arquivo para todos os canais, com confirmação, e o manda para a quarentena sem apagar. Ignorar apenas oculta o arquivo de uma lista, sem julgar a qualidade, e pode ser desfeito.',
          'Os scopes usam quadros de navegação: são inspeção visual aproximada, não medição de engenharia.',
        ],
      },
    ],
  },
  {
    id: 'sinais',
    title: '5. Saídas e entradas',
    icon: 'settings_input_antenna',
    badge: 'ENGENHARIA',
    summary: 'Para onde o PGM sai e como entram as fontes ao vivo.',
    sections: [
      {
        title: 'Saídas',
        tag: 'TRANSMISSÃO',
        content: 'Cadastro em Configurações › Saídas de Transmissão. O Monitor (Visão integrada) mostra o estado de cada saída: NO AR, CONECTANDO, RECONECTANDO, FALHOU.',
        steps: [
          'RTMP e SRT: envio para plataformas e receptores. NDI/OMT: rede local.',
          'SDI (DeckLink): disponível quando houver placa e driver instalados. Sem placa, a referência de tempo é o relógio do sistema (mostrado no Master).',
          'O monitor das telas é WebRTC (porta 8889). "Saída no ar · prévia sem vídeo" significa que só a prévia do navegador falhou; a saída segue.',
        ],
      },
      {
        title: 'Entradas ao vivo',
        tag: 'INGEST AO VIVO',
        content: 'Fontes OMT, NDI, SRT e outras ficam na biblioteca como AO VIVO. Encontrar a fonte na rede não prova sinal: o selo de sinal vem do engine depois do CUE.',
        steps: [
          'Live nova entra com 60 min estimados (ajustável).',
          'Fonte sem par reserva não tem troca automática; cadastre o par em Configurações › Entradas.',
        ],
      },
    ],
  },
  {
    id: 'aired',
    title: '6. Aired (registro de veiculação)',
    icon: 'history',
    badge: 'REGISTRO',
    summary: 'O que foi ao ar, por quanto tempo e como terminou.',
    sections: [
      {
        title: 'Registro operacional',
        tag: 'AS-RUN',
        content: 'Cada item que entra no PGM é registrado com início, fim e motivo de encerramento (fim do arquivo, TAKE ou parada).',
        steps: [
          'Filtros por período, tipo (VT, AO VIVO, COMERCIAL, GFX, SLATE, ENCHIMENTO) e encerramento.',
          'Exportar CSV ou XML As-run e Imprimir para arquivo.',
        ],
        note: 'É registro operacional do engine, não comprovante homologado: não atesta transmissão física nem atende sozinho a exigências regulatórias.',
      },
    ],
  },
  {
    id: 'emergencia',
    title: '7. Incidentes e contingência',
    icon: 'emergency',
    badge: 'CONTINGÊNCIA',
    summary: 'Sonda do PGM, slate, contingência, alertas e reinício.',
    sections: [
      {
        title: 'Sonda do PGM',
        tag: 'BLACK / SILÊNCIO / FREEZE',
        content: 'A sonda mede o PGM e alerta quando black, silêncio ou congelamento passam do limiar. Por padrão ela só alerta; a intervenção automática (AUTO) precisa ser ligada.',
        steps: [
          'CIENTE: registra que o operador viu o alerta e para os lembretes externos (Telegram/webhook).',
          'ACIONAR SLATE: coloca o slate de emergência; DESARMAR SLATE volta.',
          'Contingência e retorno (aba no Master): loop de reserva e volta manual à grade.',
        ],
      },
      {
        title: 'Quando algo falha',
        tag: 'RECUPERAÇÃO',
        content: 'Confira primeiro os selos do cabeçalho (ENGINE, SAÍDAS, DISCO, ALERTAS) e a Visão integrada do Monitor.',
        steps: [
          'Engine travado: Monitor › REINICIAR. O servidor recompõe a grade; o ar para por alguns segundos.',
          'Incidentes críticos sem ciente geram lembrete a cada 2 min (até 5) no canal externo configurado.',
          'Nunca atualize fora da janela 02:00–05:00 sem necessidade: a troca derruba o ar por ~3 min.',
        ],
      },
    ],
  },
]

export function DocsView({
  channel,
  channels = [channel],
  onNavigate,
  onSelectChannel = () => {},
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenSettings,
}: Props) {
  const [activeChapterId, setActiveChapterId] = useState<string>('visao-geral')
  const [searchTerm, setSearchTerm] = useState<string>('')

  // Filtragem dos capítulos e seções baseada na busca
  const filteredChapters = useMemo(() => {
    if (!searchTerm.trim()) return CHAPTERS
    const q = searchTerm.toLowerCase()
    return CHAPTERS.map((chap) => {
      const matchChapter =
        chap.title.toLowerCase().includes(q) || chap.summary.toLowerCase().includes(q)
      const matchingSections = chap.sections.filter(
        (sec) =>
          sec.title.toLowerCase().includes(q) ||
          sec.content.toLowerCase().includes(q) ||
          sec.tag.toLowerCase().includes(q) ||
          sec.steps?.some((s) => s.toLowerCase().includes(q)),
      )
      if (matchChapter) return chap
      if (matchingSections.length > 0) return { ...chap, sections: matchingSections }
      return null
    }).filter((chap): chap is DocChapter => chap !== null)
  }, [searchTerm])

  const activeChapter = useMemo(() => {
    return filteredChapters.find((c) => c.id === activeChapterId) || filteredChapters[0] || CHAPTERS[0]
  }, [filteredChapters, activeChapterId])

  return (
    <div className="bg-surface-base text-on-surface antialiased select-none flex flex-col h-screen overflow-hidden font-body-md text-body-md">
      {/* 1. CABEÇALHO PADRÃO RPLAYOUT */}
      <BroadcastHeader
        activeWorkspace="docs"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        onOpenSettings={onOpenSettings || (() => onNavigate('settings'))}
      />

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden">
        {/* 2. BARRA DE TÍTULO TÁTICA */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-margin py-3 flex flex-wrap items-center justify-between gap-gutter shadow-sm shrink-0">
          <div className="flex items-center gap-space-md">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-sm">
              <span className="material-symbols-outlined text-[20px]">menu_book</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-headline-md text-headline-md tracking-wider text-on-surface uppercase leading-none font-bold">
                  DOCS // MANUAL OPERACIONAL BROADCAST
                </h1>
                <span className="font-label-caps text-[11px] px-2 py-0.5 rounded bg-primary-container text-on-primary-container border border-border-strong font-bold uppercase">
                  VERSÃO 1.1
                </span>
              </div>
              <span className="font-label-mono text-label-mono text-outline">
                Procedimentos de exibição contínua 24/7 • Topologia de sinais • Recuperação e conformidade
              </span>
            </div>
          </div>

          {/* Ações de Impressão e Atalhos */}
          <div className="flex items-center gap-space-sm">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-body-sm text-[12px] transition-colors cursor-pointer"
              title="Imprimir manual ou exportar para PDF"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir / Salvar PDF</span>
            </button>
            <button
              onClick={() => onNavigate('master')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-primary hover:bg-accent-ice text-surface-base font-body-sm text-[13px] font-semibold transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">play_circle</span>
              <span>VOLTAR AO MASTER</span>
            </button>
          </div>
        </div>

        {/* 3. BARRA DE BUSCA EM TEMPO REAL */}
        <div className="px-margin pt-space-md shrink-0">
          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex items-center gap-3 shadow-sm">
            <span className="material-symbols-outlined text-outline text-[20px] ml-1">search</span>
            <input
              type="text"
              placeholder="Buscar por funcionalidade, erro, codec, procedimento de emergência, SDI, LUFS..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent text-on-surface placeholder-outline font-body-sm text-[13px] outline-none"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="text-outline hover:text-on-surface p-1 rounded transition-colors"
                title="Limpar busca"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
            <span className="font-label-mono text-[12px] text-outline px-2 py-0.5 rounded bg-surface-panel border border-border-subtle">
              {filteredChapters.length} capítulos encontrados
            </span>
          </div>
        </div>

        {/* 4. CORPO PRINCIPAL COM SIDEBAR DE CAPÍTULOS E CONTEÚDO */}
        <div className="px-margin py-space-md lg:flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-gutter lg:overflow-hidden">
          {/* Sidebar de Capítulos */}
          <aside className="w-full lg:w-80 flex flex-col gap-1.5 shrink-0 max-h-[50vh] lg:max-h-none overflow-y-auto broadcast-scroll pr-1">
            <span className="font-label-caps text-[11px] text-outline uppercase font-bold px-1 mb-1">
              Índice de Capítulos
            </span>
            <div className="bg-surface-card rounded-xl border border-border-subtle p-2 flex flex-col gap-1 shadow-sm">
              {filteredChapters.map((chapter) => {
                const isActive = activeChapter?.id === chapter.id
                return (
                  <button
                    key={chapter.id}
                    onClick={() => setActiveChapterId(chapter.id)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                      isActive
                        ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel border border-transparent'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] mt-0.5 shrink-0">
                      {chapter.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-body-sm text-[12px] truncate leading-tight">
                          {chapter.title}
                        </span>
                        <span
                          className={`text-[11px] px-1.5 py-0.2 rounded font-label-caps font-bold shrink-0 ${
                            isActive
                              ? 'bg-surface-base/30 text-on-primary-container'
                              : 'bg-surface-panel text-outline'
                          }`}
                        >
                          {chapter.sections.length}
                        </span>
                      </div>
                      <p className="font-body-sm text-[11px] text-outline truncate mt-0.5 font-normal">
                        {chapter.summary}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Caixa Rápida de Atalhos de Teclado */}
            <div className="bg-surface-card rounded-xl border border-border-subtle p-3 mt-2 shadow-sm flex flex-col gap-2">
              <span className="font-label-caps text-[11px] text-primary uppercase font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">keyboard</span>
                Atalhos Rápidos de Estúdio
              </span>
              <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[12px]">
                <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                  <span className="text-outline">TAKE:</span>
                  <span className="font-bold text-on-surface">ESPAÇO</span>
                </div>
                <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                  <span className="text-outline">CUE:</span>
                  <span className="font-bold text-on-surface">F2</span>
                </div>
                <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                  <span className="text-outline">DESFAZER:</span>
                  <span className="font-bold text-on-surface">CTRL+Z</span>
                </div>
                <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                  <span className="text-outline">REFAZER:</span>
                  <span className="font-bold text-on-surface">CTRL+Y</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Painel de Conteúdo do Capítulo Ativo */}
          <section className="lg:flex-1 flex flex-col gap-gutter min-w-0 lg:overflow-y-auto broadcast-scroll pr-2">
            {activeChapter ? (
              <div className="flex flex-col gap-gutter">
                {/* Header do Capítulo */}
                <div className="bg-surface-card rounded-xl border border-border-subtle p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[22px]">
                        {activeChapter.icon}
                      </span>
                      <h2 className="font-headline-md text-[18px] text-on-surface font-bold">
                        {activeChapter.title}
                      </h2>
                      <span className="font-label-caps text-[11px] px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 font-bold">
                        {activeChapter.badge}
                      </span>
                    </div>
                    <p className="font-body-sm text-[12.5px] text-outline mt-1 leading-relaxed">
                      {activeChapter.summary}
                    </p>
                  </div>
                </div>

                {/* Seções Técnicas */}
                {activeChapter.sections.map((sec, idx) => (
                  <article
                    key={idx}
                    className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm flex flex-col gap-3.5"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
                      <h3 className="font-headline-md text-[15px] text-on-surface font-bold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary"></span>
                        {sec.title}
                      </h3>
                      <span className="font-label-caps text-[11px] px-2 py-0.5 rounded bg-surface-panel border border-border-subtle text-outline font-bold">
                        {sec.tag}
                      </span>
                    </div>

                    <p className="font-body-sm text-[13px] text-on-surface-variant leading-relaxed">
                      {sec.content}
                    </p>

                    {/* Passos e Procedimentos */}
                    {sec.steps && sec.steps.length > 0 && (
                      <div className="bg-surface-panel rounded-lg p-3.5 border border-border-subtle/80 flex flex-col gap-2">
                        <span className="font-label-caps text-[11px] text-outline uppercase font-bold">
                          Procedimento Recomendado:
                        </span>
                        <ul className="flex flex-col gap-1.5 font-body-sm text-[12px] text-on-surface">
                          {sec.steps.map((step, sIdx) => (
                            <li key={sIdx} className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent-ice mt-1.5 shrink-0"></span>
                              <span className="leading-snug">{step}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Alerta / Nota Operacional */}
                    {sec.note && (
                      <div className="bg-primary/10 border-l-4 border-primary p-3 rounded-r-lg flex items-center gap-2.5 text-[12px] text-on-surface">
                        <span className="material-symbols-outlined text-primary text-[18px] shrink-0">
                          info
                        </span>
                        <span className="font-body-sm">{sec.note}</span>
                      </div>
                    )}

                    {/* Parâmetros Técnicos Estruturados */}
                    {sec.technicalDetails && sec.technicalDetails.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {sec.technicalDetails.map((td, tdIdx) => (
                          <div
                            key={tdIdx}
                            className="bg-surface-panel px-3 py-2 rounded border border-border-subtle flex items-center justify-between gap-2"
                          >
                            <span className="font-label-caps text-[11px] text-outline uppercase">
                              {td.label}
                            </span>
                            <span className="font-label-mono text-[12px] text-accent-ice-bright font-bold truncate">
                              {td.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="bg-surface-card rounded-xl border border-border-subtle p-8 text-center flex flex-col items-center justify-center gap-3">
                <span className="material-symbols-outlined text-outline text-[40px]">search_off</span>
                <span className="font-headline-md text-on-surface font-bold text-[16px]">
                  Nenhum capítulo encontrado
                </span>
                <p className="font-body-sm text-outline text-[12px] max-w-md">
                  Tente alterar os termos da busca acima ou clique no botão para limpar a busca.
                </p>
                <button
                  onClick={() => setSearchTerm('')}
                  className="px-3.5 py-1.5 rounded bg-primary text-surface-base font-label-caps text-[11px] font-bold mt-1"
                >
                  Limpar Busca
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
