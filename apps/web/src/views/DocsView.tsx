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

const CHAPTERS: DocChapter[] = [
  {
    id: 'visao-geral',
    title: '1. Visão Geral & Arquitetura',
    icon: 'account_tree',
    badge: 'ARQUITETURA',
    summary: 'Estrutura 24/7 sem navegador no servidor, módulos desacoplados e fluxo linear de transmissão.',
    sections: [
      {
        title: 'Filosofia de Operação Contínua',
        tag: 'CORE 24/7',
        content:
          'O RPlayout opera com desacoplamento estrito entre o backend (RPlayout-Server.exe), o engine de reprodução multimídia (GStreamer/MediaMTX) e os clientes frontend. O fechamento ou queda de qualquer janela de navegador não interrompe a exibição do canal no ar.',
        steps: [
          'O processo RPlayout-Server.exe mantém o estado da grade, relógio NTP e banco de dados SQLite persistente.',
          'Cada canal possui seu próprio pipeline de engine independente: a queda de um canal não afeta os demais.',
          'Monitores de estúdio e operadores consomem fluxos WebRTC WHEP de baixa latência diretamente do MediaMTX.',
        ],
        technicalDetails: [
          { label: 'Serviço Backend', value: 'Node.js / Bun Core 24/7' },
          { label: 'Pipeline Gráfico', value: 'GStreamer 1.22+ NVENC / CPU' },
          { label: 'Loopback WebRTC/SRT', value: 'MediaMTX (RTSP 8554 / WHEP 8889 / SRT 8890)' },
          { label: 'Armazenamento', value: 'SQLite com WAL & Transações Atômicas' },
        ],
      },
      {
        title: 'Módulos e Espaços de Trabalho',
        tag: 'NAVEGAÇÃO',
        content:
          'O sistema organiza as responsabilidades operacionais em 6 estações de trabalho dedicadas acessíveis no cabeçalho superior:',
        steps: [
          'MASTER: Controle da exibição no ar (PGM), próximo evento (PVW), acervo MAM e grade viva.',
          'PLAYLIST: Programação diária 24h, navegação por calendário, importação de blocos e publicação.',
          'QC (Quality Control): Inspeção técnica de mídias, scopes (Waveform/Vectorscope/Audio) e aprovação.',
          'MONITOR: Telemetria de engenharia, status SDI/NDI/SRT/WebRTC, failover A/B e logs de sistema.',
          'AIRED: Comprovante oficial de veiculação (As-Run Log), conformidade regulatória ANCINE e exportação CSV.',
          'DOCS: Manual operacional unificado, procedimentos de contingência e documentação técnica.',
          'CONFIGURAÇÕES: Geometria de vídeo, cadência, padrões de áudio LUFS, saídas, entradas e controle RBAC.',
        ],
      },
    ],
  },
  {
    id: 'operacao-master',
    title: '2. Operação Diária & No Ar',
    icon: 'play_circle',
    badge: 'OPERAÇÃO',
    summary: 'Procedimentos de disparo, transições TAKE, controle de fader e bloqueio de rolagem.',
    sections: [
      {
        title: 'Comandos de Chaveamento no Ar',
        tag: 'PLAYOUT CONTROLS',
        content:
          'A operação do canal em tempo real exige precisão de quadros (frame-accurate). Os comandos centrais estão permanentemente disponíveis na barra de controle do Master:',
        steps: [
          'PREPARAR (Armar): Carrega o item selecionado da grade no barramento de PVW, validando decodificação.',
          'TAKE (Espaço): Executa o corte imediato entre PVW e PGM. O item anterior é registrado no As-Run Log.',
          'PARAR (Manual): Interrompe a saída PGM e projeta a imagem de emergência / barras de cor calibradas.',
          'PGM FIXADO (Lock Scroll): Trava a rolagem automática da grade no evento em execução, mantendo visibilidade operacional.',
        ],
        note: 'DICA OPERACIONAL: O atalho de teclado BARRA DE ESPAÇO executa TAKE instantâneo se a janela estiver com foco.',
      },
      {
        title: 'Controle de Áudio & Fader de Ganho',
        tag: 'ÁUDIO BROADCAST',
        content:
          'O RPlayout inclui controle de ganho digital vertical estendido (-24 dB a +12 dB) e monitoração comutável entre PGM e Preview:',
        steps: [
          'O medidor de volume do monitor de vídeo permite escuta local no navegador via WebRTC Opus.',
          'Por segurança, o áudio de monitoração local opera em modo mutuamente exclusivo: PGM OU Preview ativo, prevenindo cacofonia.',
          'O fader vertical na lateral da grade aplica ganho imediato ao elemento em reprodução sem interrupção de vídeo.',
          'A regressiva de tempo restante (COUNTDOWN) pisca em vermelho de alto contraste nos últimos 30 segundos do evento.',
        ],
        technicalDetails: [
          { label: 'Padrão Regulatório', value: 'EBU R128 / ITU-R BS.1770-4' },
          { label: 'Target de Loudness', value: '-24.0 LUFS (±0.5 LU)' },
          { label: 'Teto de Pico Verdadeiro', value: '-1.0 dBTP máx' },
          { label: 'Escala do Fader', value: '-24 dB a +12 dB com marcação unity 0 dB' },
        ],
      },
    ],
  },
  {
    id: 'playlists-24h',
    title: '3. Playlists 24h & Programação',
    icon: 'calendar_month',
    badge: 'PROGRAMAÇÃO',
    summary: 'Criação e gestão de grades diárias, navegação de datas e publicação automatizada.',
    sections: [
      {
        title: 'Navegação por Calendário & Datas Futuras',
        tag: 'CALENDAR SCHEDULER',
        content:
          'A tela de Playlists permite planejar a programação com dias ou semanas de antecedência. Utilize o seletor de data no cabeçalho secundário para alternar entre os dias:',
        steps: [
          'Selecione uma data no calendário para carregar a grade programada daquele dia.',
          'Se a data futura estiver vazia, o sistema exibe opções de "Copiar Grade de Hoje" ou "Iniciar Grade Vazia".',
          'A barra de progresso temporal (Timeline Dinâmica) reflete com precisão os horários previstos de início e término de cada bloco.',
          'Eventos sem arquivo vinculado no MAM são sinalizados com alerta amarelo para conferência antes do ar.',
        ],
      },
      {
        title: 'Importação & Formatos de Roteiro',
        tag: 'IMPORTAÇÃO',
        content:
          'O RPlayout suporta ingestão de arquivos de automação e listas em múltiplos formatos padrão de emissoras:',
        steps: [
          'M3U / M3U8: Aceita durações em segundos (#EXTINF) e caminhos absolutos ou relativos de arquivos.',
          'CSV / TXT: Colunas de Código de Mídia, Título, Duração (TC), Categoria e Horário de Exibição Previsto.',
          'Drag & Drop: Arraste arquivos .m3u diretamente sobre a janela do navegador para abrir o assistente de publicação.',
          'PUBLICAR NA GRADE: Envia a playlist concluída para a fila ativa de exibição sem derrubar o evento que está no ar.',
        ],
      },
    ],
  },
  {
    id: 'controle-qualidade',
    title: '4. Controle de Qualidade (QC) & Acervo',
    icon: 'verified',
    badge: 'QUALIDADE',
    summary: 'Inspeção de conformidade técnica, scopes, verificação de codecs e acervo MAM.',
    sections: [
      {
        title: 'Scopes em Tempo Real & Filmstrip',
        tag: 'VETORSCOPE & WAVEFORM',
        content:
          'O módulo QC oferece instrumental avançado de análise para operadores técnicos e engenharia:',
        steps: [
          'Filmstrip Interativo: Linha do tempo visual com miniaturas em 10%, 25%, 50%, 75% e 90% do arquivo para detecção rápida de falhas.',
          'Waveform Luminância: Análise de níveis de branco e preto (0 a 100 IRE) prevenindo clipping de vídeo.',
          'Vectorscope Crominância: Verificação de saturação de cores e alinhamento de fase de subportadora.',
          'Medidor de Áudio EBU: Leitura de Loudness integrado, True-Peak e balanço estéreo (correlação de fase).',
        ],
        technicalDetails: [
          { label: 'Codecs de Vídeo Homologados', value: 'ProRes 422, DNxHD, H.264/AVC (High@L4.2), H.265/HEVC' },
          { label: 'Taxa de Quadros Padrão', value: '1080i59.94 / 1080p59.94 (Padrão Broadcast)' },
          { label: 'Amostragem de Cor', value: '4:2:2 10-bit ou 4:2:0 8-bit compatível' },
          { label: 'Codecs de Áudio', value: 'PCM 24-bit 48kHz / AAC-LC 320kbps' },
        ],
      },
      {
        title: 'Aprovação & Rejeição no MAM',
        tag: 'STATUS TÉCNICO',
        content:
          'Nenhum conteúdo com falha crítica deve ir ao ar desavisadamente. O QC classifica cada arquivo do acervo em três estados:',
        steps: [
          'APROVADO (Verde): Arquivo em conformidade total de resolução, aspecto 16:9, áudio estéreo e níveis regulatórios.',
          'ATENÇÃO (Amarelo): Desvio leve de LUFS (ajustável via ganho) ou metadados incompletos.',
          'REJEITADO (Vermelho): Ausência de vídeo/áudio, formato 9:16 vertical sem letterbox ou arquivo corrompido.',
        ],
      },
    ],
  },
  {
    id: 'saidas-entradas-sinais',
    title: '5. Saídas, Entradas & Sinais',
    icon: 'settings_input_component',
    badge: 'ENGENHARIA',
    summary: 'Roteamento de sinais DeckLink SDI, NDI, SRT Caller/Listener, RTMP e WebRTC WHEP.',
    sections: [
      {
        title: 'Como o RPlayout Envia Sinal (Saídas)',
        tag: 'TRANSMISSÃO',
        content:
          'O pipeline de saída multiplexa o sinal PGM gerado pelo engine em múltiplos destinos simultâneos conforme configurado no painel:',
        steps: [
          'DeckLink SDI (Hardware): Saída direta em banda base sem compressão para roteadores SDI e mestres de transmissão (sdi:0, sdi:1). Relógio travado pelo genlock da placa.',
          'NDI (Rede Local): Fluxo multicast de alta qualidade e baixa latência anunciado na sub-rede para switchers TriCaster, vMix ou estúdios remotos.',
          'SRT Caller / Listener: Envio protegido por correção de erros (ARQ) para CDNs, operadoras de cabo ou repetidoras de micro-ondas via porta UDP dedicada.',
          'RTMP Push: Envio h.264/AAC para servidores YouTube Live, Facebook, Twitch ou ingestões legadas.',
          'WebRTC WHEP (Monitor): Canal de monitoração ultra baixa latência (<150ms) com áudio Opus para navegadores dos operadores.',
        ],
        technicalDetails: [
          { label: 'SDI Driver', value: 'Blackmagic Desktop Video 12.4+' },
          { label: 'NDI Versão', value: 'NDI 5 / 6 Advanced SDK' },
          { label: 'SRT Latência Recomendada', value: '120ms (LAN) / 800ms (WAN/Internet)' },
          { label: 'MPEG-TS PID Padrão', value: 'Vídeo 0x100 (H.264), Áudio 0x101 (AAC/Opus)' },
        ],
      },
      {
        title: 'Como o RPlayout Recebe Sinal (Entradas & Ao Vivo)',
        tag: 'INGEST',
        content:
          'Fontes externas podem ser inseridas na grade como itens dinâmicos sem necessidade de arquivos físicos:',
        steps: [
          'SDI / HDMI Ingest: Placas Blackmagic DeckLink capturam câmeras ou links externos. Referência de grade: "sdi:0".',
          'NDI Network Discovery: O sistema vasculha automaticamente a rede local em busca de fontes NDI anunciadas (ex: "ndi:Estúdio-1").',
          'SRT Feeds Remotos: Conexão direta a links de repórteres de rua ou afiliadas informando URLs diretas (ex: srt://ip:porta).',
          'Convidados WebRTC (Guest Links): Chaves de convidados geradas pelo sistema permitem que participantes enviem áudio e vídeo pelo navegador com baixa latência.',
        ],
      },
    ],
  },
  {
    id: 'aired-asrun',
    title: '6. Comprovante de Exibição (Aired) & Auditoria',
    icon: 'history_toggle_off',
    badge: 'REGULATÓRIO',
    summary: 'Auditoria de exibição legal, conformidade com ANCINE e relatórios As-Run certificados.',
    sections: [
      {
        title: 'Registro As-Run Frame-Accurate',
        tag: 'COMPROVANTE OFICIAL',
        content:
          'Cada segundo transmitido no canal é registrado de forma indelével no banco de dados de veiculação (As-Run Log):',
        steps: [
          'O início e término exatos de cada VT ou bloco ao vivo são carimbados pelo relógio NTP mestre da estação.',
          'O motivo de encerramento é gravado com precisão: EOF (fim normal do arquivo), NEXT (corte manual TAKE) ou STOP (interrupção de emergência).',
          'Duração planejada vs. duração real veiculada são comparadas para fins de auditoria de publicidade e faturamento comercial.',
        ],
      },
      {
        title: 'Exportação para ANCINE & Emissoras',
        tag: 'CONFORMIDADE BR',
        content:
          'Gere relatórios oficiais em formato CSV compatível com os padrões de fiscalização da ANCINE e sistemas de tráfego/comercial:',
        steps: [
          'Filtre pelo dia da veiculação, categoria (VT, JORNAL, COMERCIAL, PROMO) ou status de encerramento.',
          'Clique em "EXPORTAR CSV ANCINE" para baixar o arquivo estruturado contendo ID, títulos, timecodes e quadros.',
          'Utilize a opção "Imprimir" para gerar relatórios com formatação executiva para arquivamento regulatório.',
        ],
      },
    ],
  },
  {
    id: 'procedimentos-emergencia',
    title: '7. Procedimentos de Emergência & Recuperação',
    icon: 'warning',
    badge: 'CONTINGÊNCIA',
    summary: 'Guia tático para solução de incidentes no ar, perda de sinal, desvios de áudio e failover.',
    sections: [
      {
        title: 'Tela com Mensagem "SINTONIZANDO"',
        tag: 'SINAL AUSENTE',
        content:
          'Se o monitor de PGM ou Preview do navegador permanecer na tela de "SINTONIZANDO":',
        steps: [
          '1. Verifique se o processo do canal está em execução na aba MONITOR.',
          '2. Clique no botão "TENTAR NOVAMENTE" ou recarregue o player WebRTC.',
          '3. Verifique se o MediaMTX está rodando na porta 8889 (WHEP).',
          '4. Se o engine foi reiniciado recentemente, aguarde até 3 segundos para estabelecimento do buffer WebRTC.',
        ],
        note: 'A exibição SDI física continua operando mesmo se o monitor WebRTC do navegador estiver reconectando.',
      },
      {
        title: 'Ausência de Áudio no Ar',
        tag: 'DIAGNÓSTICO DE ÁUDIO',
        content:
          'Se o vídeo estiver no ar porém sem som perceptível na monitoração:',
        steps: [
          '1. Verifique se o ícone de alto-falante do monitor web está desmutado e o controle de volume acima de 0%.',
          '2. Observe as barras de VU Meter: se houver barras verdes pulsando, o engine está gerando áudio corretamente.',
          '3. Abra os Detalhes de Áudio do item na grade e confirme se a trilha correta está selecionada (Trilha 1 ou Trilha 2).',
          '4. Verifique se o ganho do item não foi atenuado excessivamente no fader vertical.',
        ],
      },
      {
        title: 'Derrubada e Reinício do Engine sem Perda de Dados',
        tag: 'RECOVERY TOTAL',
        content:
          'Caso haja congelamento de hardware na placa SDI ou falha grave de driver:',
        steps: [
          '1. Acesse o MONITOR e clique no botão de reinício rápido do canal afetado.',
          '2. O RPlayout relê a grade imediatamente a partir da posição NTP atual sem reiniciar o servidor.',
          '3. Em caso de necessidade de reiniciar o servidor inteiro, execute RPlayout-Server.exe; a grade pré-gravada é restaurada em menos de 2 segundos.',
        ],
      },
    ],
  },
  {
    id: 'manual-fluxos',
    title: '8. Manual de Fluxos Operacionais',
    icon: 'alt_route',
    badge: 'MANUAL',
    summary: 'Roteiro ponta a ponta dos fluxos operacionais: Ingest, QC, Grade, Master Playout, Monitoramento e As-Run.',
    sections: [
      {
        title: 'Fluxo 1: Ingestão de Mídias e Controle de Qualidade (QC)',
        tag: 'INGEST // QC',
        content:
          'O fluxo de ingestão garante que apenas mídias tecnicamente conformes entrem na cadeia de exibição da emissora.',
        steps: [
          '1. Escaneamento do Acervo: Na aba QC, clique em "Escanear Ingest / Acervo" para sincronizar arquivos do diretório RPLAYOUT_MEDIA.',
          '2. Inspeção Visual e Frame-Accurate: Selecione o arquivo na tabela inferior. Visualize a reprodução de vídeo nativo (MP4/WebM) ou a régua de 24 quadros extraída via GStreamer Probe para codecs broadcast (MXF/ProRes).',
          '3. Verificação de Níveis e Scopes: Analise o Waveform (luminância 0-100 IRE), Vectorscope (crominância) e medidores EBU R128 (-24 LUFS ±0.5, True-Peak < -1.0 dBTP).',
          '4. Homologação ou Quarentena: Clique em "Aprovar QC" para liberar para a grade ou "Ignorar / Rejeitar" para isolar mídias fora do padrão com desvios graves.',
        ],
        technicalDetails: [
          { label: 'Extração de Quadros', value: '24 quadros equidistantes via GStreamer pipeline' },
          { label: 'Critério de Loudness', value: 'EBU R128: -24 LUFS integrado' },
          { label: 'Aspect Ratio Seguro', value: 'Safe Action (90%) e Safe Title (80%)' },
        ],
      },
      {
        title: 'Fluxo 2: Programação Linear 24h & Planejamento Futuro (Playlist)',
        tag: 'PROGRAMAÇÃO',
        content:
          'O fluxo de programação organiza a grade horária contínua para o dia atual e datas futuras com precisão de timecode.',
        steps: [
          '1. Seleção de Data: No calendário lateral esquerdo da aba PLAYLIST, escolha o dia desejado (hoje, amanhã ou datas futuras).',
          '2. Criação ou Cópia de Grade: Para datas sem eventos, clique em "Copiar Grade Anterior" para duplicar a programação do dia anterior ou "Criar Grade em Branco".',
          '3. Detecção e Resolução de GAPs: A barra de timeline contínua de 24h destaca intervalos sem programação em cor âmbar pulsante. Clique em "Auto-Fill Gaps" para preenchimento inteligente via catálogo MAM.',
          '4. Adição e Ajuste de Eventos: Utilize "+ Evento" para inserir VTs ou fontes ao vivo, ou "Editar Trim" para definir pontos In/Out.',
          '5. Publicação no Master: Clique em "SINCRONIZAR MASTER" (para hoje) ou "CARREGAR NO MASTER" para disponibilizar a grade na automação do ar.',
        ],
      },
      {
        title: 'Fluxo 3: Operação ao Vivo & Playout no Ar (Master Control)',
        tag: 'CONTROLE NO AR',
        content:
          'O operador gerencia o canal em tempo real garantindo continuidade ininterrupta e transições perfeitas.',
        steps: [
          '1. Seleção e Arme (Cue): Clique no evento desejado na grade central para armá-lo no barramento de Preview (PVW).',
          '2. Transição TAKE: Pressione a tecla BARRA DE ESPAÇO ou clique no botão TAKE para colocar o evento no ar (PGM) em corte instantâneo.',
          '3. Monitoração e Fader de Ganho: Monitore o áudio no monitor PGM ou PVW de forma comutável (exclusiva). Ajuste o ganho fino através do fader vertical (-24 dB a +12 dB).',
          '4. Regressiva de Segurança: Acompanhe a contagem regressiva em vermelho de alto contraste que alerta a proximidade do encerramento do evento.',
          '5. Inserção de Fontes Externas: Pelo painel do acervo MAM, adicione fontes de placa DeckLink SDI, NDI ou SRT diretamente na grade ou no preview.',
        ],
      },
      {
        title: 'Fluxo 4: Monitoramento de Engenharia, Sinais e Redundância',
        tag: 'TELEMETRIA',
        content:
          'Acompanhamento contínuo da saúde técnica das saídas SDI, fluxos IP de rede e contingência automática.',
        steps: [
          '1. Painel de Sinks: Na aba MONITOR, verifique o status operacional de SDI Hardware, NDI Multicast, SRT Caller/Listener e WebRTC WHEP.',
          '2. Failover Primário/Secundário: Acompanhe o estado de redundância (Hot-Standby). Em caso de falha de decodificação no canal A, o comutador aciona o sinal de contingência B sem interrupção de portadora.',
          '3. Terminal de Logs de Engenharia: Monitore os eventos do motor de playout em tempo real com filtros por aviso (WARN) ou motor (ENGINE).',
          '4. Ajuste de Roteamento: Abra CONFIGURAÇÕES para calibrar cadência de quadros, dispositivos DeckLink SDI e chaves de streaming.',
        ],
      },
      {
        title: 'Fluxo 5: Comprovante de Exibição, Auditoria & ANCINE (Aired)',
        tag: 'AS-RUN & ANCINE',
        content:
          'Rastreabilidade legal de cada segundo exibido para comprovação comercial e conformidade regulatória.',
        steps: [
          '1. Consulta Histórica: Na aba AIRED, filtre pela data de transmissão e visualize o log As-Run com horários exatos de início e término NTP.',
          '2. Filtros Analíticos: Segregue eventos por categoria (COMERCIAL, VT, JORNALISMO) e motivo de encerramento (EOF, TAKE, STOP).',
          '3. Auditoria de Desvios: Verifique o delta entre duração planejada e duração real executada no ar.',
          '4. Exportação Regulamentar: Clique em "EXPORTAR CSV ANCINE" para emitir a planilha oficial compatível com os órgãos de fiscalização de radiodifusão.',
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

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-hidden">
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
                <span className="font-label-caps text-[10px] px-2 py-0.5 rounded bg-primary-container text-on-primary-container border border-border-strong font-bold uppercase">
                  VERSÃO 1.1 ESTÁVEL
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
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-primary hover:bg-accent-ice text-surface-base font-headline-md text-headline-md tracking-wide transition-all shadow-sm cursor-pointer"
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
            <span className="font-label-mono text-[10px] text-outline px-2 py-0.5 rounded bg-surface-panel border border-border-subtle">
              {filteredChapters.length} capítulos encontrados
            </span>
          </div>
        </div>

        {/* 4. CORPO PRINCIPAL COM SIDEBAR DE CAPÍTULOS E CONTEÚDO */}
        <div className="px-margin py-space-md flex-1 min-h-0 flex flex-col lg:flex-row gap-gutter overflow-hidden">
          {/* Sidebar de Capítulos */}
          <aside className="w-full lg:w-80 flex flex-col gap-1.5 shrink-0 overflow-y-auto broadcast-scroll pr-1">
            <span className="font-label-caps text-[10px] text-outline uppercase font-bold px-1 mb-1">
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
                          className={`text-[10px] px-1.5 py-0.2 rounded font-label-caps font-bold shrink-0 ${
                            isActive
                              ? 'bg-surface-base/30 text-on-primary-container'
                              : 'bg-surface-panel text-outline'
                          }`}
                        >
                          {chapter.sections.length}
                        </span>
                      </div>
                      <p className="font-body-sm text-[10.5px] text-outline truncate mt-0.5 font-normal">
                        {chapter.summary}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Caixa Rápida de Atalhos de Teclado */}
            <div className="bg-surface-card rounded-xl border border-border-subtle p-3 mt-2 shadow-sm flex flex-col gap-2">
              <span className="font-label-caps text-[10px] text-primary uppercase font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">keyboard</span>
                Atalhos Rápidos de Estúdio
              </span>
              <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[10px]">
                <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                  <span className="text-outline">TAKE:</span>
                  <span className="font-bold text-on-surface">ESPAÇO</span>
                </div>
                <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                  <span className="text-outline">PARAR:</span>
                  <span className="font-bold text-on-air-crimson">ESC</span>
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
          <section className="flex-1 flex flex-col gap-gutter min-w-0 overflow-y-auto broadcast-scroll pr-2">
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
                      <span className="font-label-caps text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 font-bold">
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
                      <span className="font-label-caps text-[10px] px-2 py-0.5 rounded bg-surface-panel border border-border-subtle text-outline font-bold">
                        {sec.tag}
                      </span>
                    </div>

                    <p className="font-body-sm text-[13px] text-on-surface-variant leading-relaxed">
                      {sec.content}
                    </p>

                    {/* Passos e Procedimentos */}
                    {sec.steps && sec.steps.length > 0 && (
                      <div className="bg-surface-panel rounded-lg p-3.5 border border-border-subtle/80 flex flex-col gap-2">
                        <span className="font-label-caps text-[10px] text-outline uppercase font-bold">
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
                            <span className="font-label-caps text-[10px] text-outline uppercase">
                              {td.label}
                            </span>
                            <span className="font-label-mono text-[11px] text-accent-ice-bright font-bold truncate">
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
