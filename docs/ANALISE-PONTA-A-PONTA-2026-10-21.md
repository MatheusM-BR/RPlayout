# Análise ponta a ponta — áudio ao vivo, preview em qualidade, CUE pela grade, TAKE (21/10/2026)

Relato do operador (r88-3 instalada): "áudios de entrada ao vivo não funcionam;
preview em qualidade fica caindo; ao clicar em vídeo da grade não entra em
preview; botão TAKE não funciona".

## 1. O que a sessão da r88-3 mostra (23:02–23:33, banco copiado, só leitura)

Registro de chamadas decifrado pela chave da própria instalação (rotas,
códigos e incidentes; nenhum dado sensível copiado):

- 6 comandos de transporte, todos 200 e todos CUE. **Nenhum TAKE chegou ao
  servidor**; nenhuma linha de as-run.
- 34 renovações da "inspeção em qualidade" do QC; 2 recusas 409 ("Selecione
  novamente a fonte: ela não é mais o preview ativo do QC") logo depois de
  CUEs feitos no Master.
- Fonte do vMix no PVW: 4 perdas de imagem (1–2 s) e 3 de áudio em 6 min.
- 1.740 heartbeats de monitor 404 vieram do painel do Claude, que ficou aberto
  num canal de QA de outra instalação; não são da operação.

## 2. Reprodução nas r88-7/r88-8 de QA com fonte real

Fonte NDI local com barras e tom de 1 kHz a −12 dBFS (GStreamer + runtime NDI
do pacote) e um arquivo com tom de −21 dBFS. Resultados pela API e por clique
na interface do Master:

| Verificação | Resultado |
|---|---|
| Áudio da entrada ao vivo no PVW | −12 dBFS, SIGNAL_OK |
| Áudio da entrada ao vivo no PGM depois do TAKE | −12 dBFS |
| Clique no vídeo da grade | PVW rodando o arquivo, −21 dBFS |
| Botão TAKE (clique na interface) | arquivo no PGM, −21 dBFS |
| PVW ao vivo + inspeção do QC por 100 s | SIGNAL_OK o tempo todo, idade do vídeo ≤ 45 ms, 21/21 renovações aceitas |
| Primeira busca de fontes depois de ligar o emissor NDI | r88-7: lista vazia (achou só na segunda); r88-8: achou na primeira (3,2 s) |

## 3. Causas e correções

1. **TAKE "não funciona".** Sem nada no PVW, o botão ficava desabilitado mas
   com a mesma aparência, e o clique não fazia nada. Agora fica esmaecido e a
   linha acima diz o motivo (`takeBlockedReason`). Com algo armado, o TAKE
   funcionou pela interface.
2. **Preview em qualidade cai / vídeo da grade não fica no preview.** O QC "em
   qualidade" e o Master usam o **mesmo PVW**. Reproduzido: CUE no Master
   derruba a inspeção do QC (409), e selecionar a fonte de novo no QC tira o
   vídeo que o Master tinha armado. O servidor agora informa a inspeção ativa
   (`live.qcInspection`) e o Master avisa acima do PVW que um CUE ali encerra a
   inspeção do QC. Separar o QC num decodificador próprio é mudança de engine
   ainda não feita.
3. **Estado ao vivo perdia campos.** `liveSnapshot` copiava só parte do estado:
   o aviso do QC e o controle de troca de fonte da live sumiam da tela no
   primeiro tick do WebSocket. Corrigido, com teste.
4. **Busca de fontes.** NDI espera 2,5 s pelos anúncios (antes 1,2 s), em
   paralelo com a DeckLink.
5. **Áudio ao vivo.** Com fonte própria, o áudio entra e sai correto no PVW e
   no PGM. Na r88-3 com o vMix houve quedas de áudio junto com as de vídeo; na
   r88-6 o áudio do vMix chegava em silêncio (−90 dBFS). Sem o vMix aberto
   tocando som, não dá para separar configuração do vMix de defeito nosso: fica
   aberto. Lembrete: o monitor só toca som depois de clicar em OUVIR.

A r88-3 também não tem as correções posteriores (OMT parado reabre, monitores,
carga do servidor, canal novo com grade).

## Build

r88-9 (9463076), 13/13 PASS, Rust 125/0/4. Instalador
`D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-9-instalador.zip`,
SHA256 `2593707A8A66237B1D74E4E09B01ADB3AA38C53597FE5EF791460EC26598D41A`.
Conferido na r88-9 de QA: primeira busca achou o emissor NDI; com a inspeção
do QC ativa o Master mostrou "PVW em uso pelo QC (1 tela em inspeção de
qualidade)…" e o aviso sumiu ao encerrar a inspeção. (r88-8 ficou sem a
correção do estado ao vivo; use a r88-9.)

## QC com decodificador próprio (r88-10/r88-11)

A disputa do PVW foi eliminada, não só avisada: a inspeção "em qualidade" do QC
abre a entrada num decodificador ao vivo só do QC (comando `qcSource` do
engine); selecionar a entrada no QC não faz mais CUE no PVW do Master. O aviso
de PVW compartilhado saiu da tela do Master.

Conferido na r88-10 de QA (13/13, Rust 125/0/4) com a fonte NDI de teste:

- QC aberto na entrada ao vivo **sem** CUE: PVW do Master continua vazio;
  monitor do QC publicado em 1280×720 (resolução da fonte) com áudio Opus,
  ~6,7 Mbit/s.
- Com o QC inspecionando, o Master fez CUE do vídeo (PVW −21 dBFS), TAKE (PGM
  −21 dBFS) e CUE da própria entrada ao vivo: todas as renovações do QC
  continuaram 200, sem queda.
- Única resposta diferente: a primeira renovação logo ao abrir ("aguardando o
  primeiro quadro"), 1 a 2 s. A tela do QC agora mostra isso como "Abrindo a
  entrada…" e não como erro (r88-11).

## Limites

Ensaios com emissor NDI local, não o vMix nem outra máquina. A imagem dos
monitores não pôde ser vista no painel do Claude (porta 8889 bloqueada).
