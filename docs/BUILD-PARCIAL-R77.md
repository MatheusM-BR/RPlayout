# RPlayout r77 — parcial instalável para teste interno

**SUPERADA — não usar para este diagnóstico; corrigido posteriormente na r78.**
Integridade do ZIP PASS (7.094 hashes/7.095 entradas), mas gPFOlH encontrou
falso vencimento: relógio da lista anterior à nova medição WS. Não é pacote
funcionalmente aprovado. Preservado para rastreabilidade, não sobrescrito.
540.205.869 bytes; SHA256
`37EA7226E1BD78C653467C4D14B4F3C17A9C33F0B8086CD96C4006826A9D1090`.

Destino previsto: `release/RPlayout-1.1-parcial-20261016-r77-instalador.zip`.
Registrar tamanho, SHA256 e integridade após a geração; não antecipar aprovação.

Inclui engine da r76 e nova interface de diagnóstico das entradas no QC:

- Dados retidos passam a mostrar **Última amostra (histórica)**, inclusive
  idade do quadro na coleta. Não afirmam sinal atual de entrada não sintonizada.
- Medição recente é vinculada ao barramento PGM/PVW correspondente. Idade do
  quadro inclui tempo desde a coleta e confirmação verde vence sem novas
  medições; áudio ausente/vencido não aparece como recebido atualmente.
- Uma conexão SRT OPTIMAL é identificada como rede e não confirma vídeo.
- Uma atualização local por segundo na lista visível expira o estado antigo;
  não adiciona polling por fonte, decoder ou comando de CUE/TAKE.

Interface `index-BBLM5VJo.js`, SHA256
`DAC2F8C04F8E85EFA37DE16EB7CD54E8812ACD92E1715C0CFD4DEEB0B773870D`.
Checagem de tipos/build web PASS; 78 casos distintos afetados PASS (77 da
rodada e replay de 18 do helper final, 17 sobrepostos). Corrigido erro inicial
de tipo no teste (delete de campo obrigatório); pnpm sem saída interrompido,
testes executados diretamente pelo Node do pacote. Não contar interrupção
como aprovação. Prova visual do lote ainda em andamento na geração deste texto.

Engine preservado SHA256
`191CD1E112C7AFBA81896BBF3AA109A100775A7A358B7894FAAAFBE8D1ABDFBC`;
servidor preservado
`A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
Nenhuma alteração nativa neste lote; ensaios nativos afetados da r76 não foram
repetidos apenas por mudança de interface/status.

Node, módulos de produção, SQLite e runtimes incluídos; sem tsx/tsc/pnpm
globais no uso. Instalador/startup r77 NOT_RUN. Testes com sobreposição
explícita na r71 não homologam instalação r77, Windows limpo ou estação remota.
Redistribuição REVIEW_REQUIRED: acordo original NDI indisponível. Não publicar
como pacote liberado juridicamente. Driver DeckLink externo; validação física
adiada. Sem novas permissões de rede/firewall, limpeza, migração ou dados de
produção. Pacotes anteriores preservados.

Local: localhost e porta configurada (4000 por padrão). Remoto: IP/nome e
porta reais do servidor; 192.168.42.172 não é fixado no produto.

Totais: 10 grupos/53 verificações, 7 concluídas, 35 em andamento, 4 pendentes
e 7 adiadas à v3 (grupo 8). Não é entrega final homologada.
