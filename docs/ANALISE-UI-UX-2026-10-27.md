# Análise de layout, UI e UX — 27/10/2026

Base: r88-25 no ar (grade RW em loop, live vMix Output 1 no ar), telas vistas
em 1920×1080 (Master, Playlist, QC, Monitor, Aired), código de `apps/web` e as
referências do Stitch que já estão em `stitch/`. O Stitch do Google não pôde
ser usado agora: exige entrar com conta Google, e eu não faço login com senha.
As propostas abaixo são minhas, com base em playouts de mercado (xPlayout,
Cinegy Air, PlayBox AirBox, Imagine/ADC, iTX).

## 1. O que foi visto

| Tela | Situação |
|---|---|
| Master | Em 1080p a grade aparece só no terço de baixo (~5 linhas). Acima dela: faixa de alerta, sonda de qualidade, 3 barras recolhíveis (contingência, próxima grade, inserção), o bloco NO AR/PGM/PVW/TAKE e a barra de grafismos. |
| Master | Live no ar com "TEMPO RESTANTE 00:00" e progresso 100% há 20 min: a live passou da estimativa, mas a tela não diz que passou nem quanto. |
| Master | PRÓXIMO mostra "Duração 00:00 / Disparo em 00:00" quando o item está atrasado. |
| Master | Alerta de silêncio fixo no topo (1 835 s) — a live do vMix está chegando sem áudio. O alerta empurra o layout e não tem "ciente". |
| Master/Playlist | A mesma live aparece 3× na biblioteca com o mesmo nome (OMT + 2 NDI) e duração diferente por tela (14:59 no Master, 1:00:00 na Playlist). |
| Cabeçalho | Master diz "NO AR"; Playlist e Monitor dizem "PGM: N/D" no mesmo minuto. Selos "SDI/NDI: CONFIG., NVENC: MONITOR" não dizem se está tudo bem. |
| Playlist | "Data ativa 27/10 (grade editorial)" com 1 567 linhas (loop de 4 itens repetido), enquanto o ar toca outra grade (loop de 20/10). O operador não vê qual grade está no ar nem a diferença entre as duas. |
| Playlist | Tabela com colunas largas vazias; título do item fica longe do horário. |
| QC | Botão "Aprovar" também nos itens já aprovados; LUFS "N/D" em todos. |
| Monitor | "Nenhuma entrada configurada" num painel e 3 entradas listadas no outro. 8 subabas; HA (fica para v3) ocupa espaço. |
| Aired | Mostra "00:00:00 / 0" enquanto carrega, depois 21 h / 1 957 registros: parece vazio nos primeiros segundos. |
| Geral | 469 textos com 7–10 px no código. Na distância de operação (60–80 cm) isso não é legível. CUE no F11 (tecla de tela cheia do navegador). |

## 2. Problemas, por prioridade

| # | Problema | Efeito no ar | Proposta |
|---|---|---|---|
| U1 | Grade espremida no Master | Operador rola para ver o próximo bloco; risco de não ver o que vem | Layout fixo em 3 faixas: (a) faixa do ar 120 px — NO AR, contagem, PRÓXIMO, TAKE/CUE; (b) grade ocupando o resto (≥ 60% da altura, ≥ 15 linhas em 1080p); (c) coluna direita com PGM/PVW e áudio. Contingência, próxima grade, inserção e grafismos vão para uma gaveta "Ferramentas" (atalho) |
| U2 | Informação contraditória | Decisão errada (achar que a live acabou; achar que o canal está fora) | Uma fonte só para estado do ar no cabeçalho em todas as telas; live passada da estimativa mostra **+MM:SS excedido** em âmbar; PRÓXIMO atrasado mostra "atrasado +MM:SS"; duração de live igual em todas as telas |
| U3 | Duas grades sem relação visível | Editar a grade errada | Cabeçalho da Playlist com "No ar: Grade — RW (loop desde 20/10)" e "Editando: 27/10"; diferença antes de publicar; loop mostrado como um bloco "Loop de 4 itens (5 min 18 s) × até 23:59" em vez de 1 567 linhas |
| U4 | Fontes ao vivo duplicadas | Escolher a fonte errada (OMT vs NDI) | Uma fonte por origem com o protocolo como selo (OMT · NDI); duplicadas agrupadas; Monitor e biblioteca leem a mesma lista |
| U5 | Alerta permanente que empurra o layout | Fadiga de alerta; layout pula | Alertas numa faixa de status de altura fixa, com "ciente" (registrado no As-run) e contador; o alerta some quando a condição some |
| U6 | Texto pequeno | Erro de leitura de horário | Mínimo 12 px para dados, 11 px para rótulos; horários em monoespaçada 14–16 px; NO AR / contagem 32+ px |
| U7 | Monitor do navegador "reconectando" sem dizer se a saída está ok | Pânico falso | Separar "saída do engine: OK" de "pré-visualização no navegador: sem vídeo" |
| U8 | Ações que não batem com o estado (QC) | Cliques inúteis | Botão conforme o estado (Aprovado → "Revogar"); LUFS medido ou "medir" |
| U9 | Navegação larga | Operador entra em telas de engenharia | Modos por perfil: Operação (Master, Playlist), Acervo (QC), Engenharia (Monitor, Saídas, HA), Registro (Aired). Operador vê só o primeiro grupo por padrão |
| U10 | Teclado | Lentidão | CUE em F2/Enter (F11 é do navegador), TAKE Espaço, ABORT Esc; legenda dos atalhos visível; foco sempre na grade |
| U11 | Telas que parecem vazias enquanto carregam | Desconfiança | Estado "carregando" explícito em vez de zeros |
| U12 | Selos técnicos sem valor | Ruído | Trocar por saúde real: Saída (fps/quadros perdidos), Engine, Disco, Fontes ao vivo |

## 3. Layout proposto do Master (1920×1080)

```
┌ cabeçalho 48px: RPlayout · Canal RW · NO AR ● · relógio 17:31:13 · Operação | Acervo | Engenharia | Registro · alertas(2) ┐
├ faixa do ar 120px ──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NO AR  DESKTOP-RP4CK8E (vMix)  AO VIVO   +21:58 excedido │ PRÓXIMO Abertura de Sinal  00:16  atrasado │ [CUE F2][TAKE ␣][ABORT Esc] │
├ grade (resto da altura) ─────────────────────────────────────────────────┬ coluna 480px ──────────────────────────────┤
│ #  status   início     duração  título                       tipo         │ PGM (16:9)                                │
│ 3  exibido  16:54:08   00:17    Abertura de Leilão           VT           │ PVW (16:9)                                │
│ 4  NO AR    16:54:26   14:59+   DESKTOP-RP4CK8E (vMix) OMT   AO VIVO      │ áudio PGM: L/R, LUFS-I, TP               │
│ 5  próximo  17:16:24   00:16    Abertura de Sinal            VT           │ biblioteca (aba) / ferramentas (aba)     │
│ … ≥15 linhas visíveis                                                     │                                           │
├ status 28px: Saída OK 29,97 · 0 quadros perdidos · Engine OK · Disco 579 GB · Silêncio na live (ciente) ─────────────────┤
```

## 4. Plano

| Fase | Itens | Risco no ar |
|---|---|---|
| 1 — correções rápidas | U2, U5, U6 (tamanhos mínimos), U8, U10, U11 | baixo (só interface) |
| 2 — Master novo | U1, U4, U7, U12 | médio: trocar layout com operador; manter o antigo atrás de uma opção por 1 semana |
| 3 — Playlist e navegação | U3, U9 | médio: mexe no fluxo de publicação |

Pendente do operador: a live do vMix Output 1 está chegando **sem áudio**
(silêncio −90 dBFS há mais de 30 min) — conferir o áudio da saída do vMix.

## 5. GC com títulos GT do vMix (decisão 27/10: rodar no RPlayout, 4 a 8 overlays)

- G1 (r88-28): importar `.gtzip`/`.gtxml` em Configurações › grafismo ›
  Gerenciar artes. Conferido com os 743 títulos GT desta máquina: 743
  convertidos. Campos com o nome do vMix (`Headline.Text`).
- G2 (r88-28): Overlays 1–8 no Master (ENTRA, SAI, CORTE, ✕). O engine anda a
  animação do título (Fly, Bounce, Fade, Expand, Reveal, Zoom, ZoomFade,
  Rotate, None) a ~30 quadros/s e para de redesenhar quando o título assenta.
  Sem storyboard de saída, a entrada volta ao contrário (como no vMix). Arte SVG
  comum entra/sai com fade de 300 ms. Slot 1 atrás, 8 na frente, por cima das
  camadas fixas.
- Limites atuais: animações contínuas (FillOffset, Scroll, RotateContinuous,
  Ticker) ficam paradas; estado dos overlays só em memória (reinício do
  servidor esvazia; reinício só do engine repõe em corte); sem registro no
  As-run nem replicação HA.
- G3 (salvar `.gtzip`) e G4 (comandar o próprio vMix) continuam propostos.
