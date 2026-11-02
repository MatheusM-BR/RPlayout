# RPlayout r40 — instalador parcial, não homologado

Inclui r39 e paginação real dos incidentes de saúde: mais recentes primeiro,
30 registros por página, navegação anterior/mais recentes e filtros de
severidade/reconhecimento aplicados no servidor. Contagem de pendentes abrange
todo o canal, sem ser limitada à página. Janela histórica de datas fixa; ACK
e retenção refletem o estado atual, não um snapshot imutável do banco.

Corrige a tela que recebia 200 eventos e mostrava só 30 sem navegação. IDs
desempatam horários iguais e ACL é reaplicada em cada consulta. Aviso de falha
no reconhecimento permanece separado da atualização automática da telemetria.
CSV informa limite de 10.000 eventos recentes; não representa exportação ilimitada.

Lote local: 18 testes servidor + 2 interface, tipos e builds aprovados.
Navegador com servidor compilado isolado: 9 páginas/253 eventos, 245 históricos
únicos, filtro encontra crítico antigo além dos 200 primeiros; ACK200 auditado
sem resolução. Fonte sintética e engine desabilitado; não prova sinal físico.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Backup dos dados e
cofre antes da migração47. Pacote antigo não é rollback homologado do banco.
Inclui Node, módulos de produção/SQLite, GStreamer, NDI/OMT/MSVC; não exige
pnpm/tsx/tsc no destino. DeckLink requer driver oficial Blackmagic.

Sem teste de instalação, Setup.exe assinado ou partida automática do servidor.
Releases anteriores preservadas. Não usar como entrega final para operação no ar.
Faltam homologações físicas/remotas, desempenho prolongado e fechamento dos
demais grupos, incluindo correlação operacional dos incidentes.

Totais: 10 grupos — 1 concluído e 9 abertos. 53 verificações — 5 concluídas,
24 em andamento e 24 pendentes. 9.2 permanece em andamento.

Registro externo após empacotamento (não integra o LEIA-ME interno):
450393956 bytes; SHA-256
8095768CB029E8D486DD9A4CD618C61AD57005BD0E1D55AEEEF64F60E25F06FA.

Limitações de continuação: ao voltar à primeira página, a consulta volta à
janela atual; falta preservar também essa âncora até MAIS RECENTES. A consulta
agregada legada de distribuição ainda precisa de cancelamento/deadline e
proteção contra sobreposição. Não considerar essas condições homologadas.
