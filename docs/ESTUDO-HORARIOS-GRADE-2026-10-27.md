# Estudo — horários da grade, ao vivo e horário fixo (27/10/2026)

## 1. O que foi visto no ar (r88-25)

- Grade no ar: "Grade — RW", **data 20/10**, em **loop**. Em 27/10 às 16:54 o
  início mostrado era `184:54:26` = 7 dias × 24 h + 16:54:26.
- Existe uma segunda grade "Grade — RW — 2026-10-27" (loop), que não está no
  ar.
- Lives da vMix Output 1 inseridas hoje: uma no ar, outra "a seguir".

## 2. Causas

| # | Problema | Causa no código |
|---|---|---|
| P1 | Horário > 24 h (184:54:26) | Todo horário é "quadros desde a meia-noite da data da grade" (`rundownFrames`). Grade em loop não troca de data; depois de 7 dias o relógio passa de 168 h. `formatClock` não sabe de dias. |
| P2 | Horário fixo "aleatório" | Âncora FIXED guarda "quadros desde a meia-noite do dia 0 da grade" (`at = HH:MM:SS × fps`). Na grade em loop de 20/10, "17:00" aponta para 20/10 17:00 — 7 dias no passado. A âncora é perdida e o item segue o fluxo, caindo num horário qualquer. |
| P3 | Live entra sem horário | Live arrastada da biblioteca entra como FLOW (`anchor: {kind:'FLOW'}`). No formulário "Programa ao vivo" o padrão é 20:00:00; na edição de horário o padrão é o horário calculado do fluxo ou 12:00:00. Nunca o horário atual. |
| P4 | Campo de horário aceita lixo | `Number(p) || 0`: "ab:cd" vira 00:00:00 sem aviso. |
| P5 | Duas grades para o mesmo período | Nada indica qual está no ar nem impede sobreposição. |

## 3. Como os playouts profissionais tratam

Prática comum em playouts de mercado (xPlayout, Imagine/ADC, Grass Valley
iTX, Harmonic, Cinegy Air, PlayBox AirBox, Evertz):

1. **Dia de transmissão.** Cada lista pertence a uma data e a um início de dia
   (ex.: 06:00). Os horários aparecem como relógio de parede `HH:MM:SS(:QQ)`;
   o que passa da meia-noite mostra a data seguinte. Nunca 184 h.
2. **Horário absoluto.** Evento fixo guarda data + hora (fuso local
   sincronizado por NTP), não deslocamento relativo a um dia antigo.
3. **Tipos de entrada explícitos.** *Sequencial* (após o anterior); *Fixo
   suave* (espera o item atual terminar ou o próximo ponto); *Fixo rígido*
   (corta no horário); *Manual* (fica em espera até o TAKE).
4. **Ao vivo é evento com início e fim obrigatórios.** Início: agora, horário
   fixo ou após o anterior. Fim: duração, até um horário, ou manual (até o
   operador encerrar), com material de reserva se a fonte cair.
5. **Padrões sensatos.** "Agora" já vem preenchido com a hora atual
   (arredondada para o próximo minuto); horário no passado pede confirmação ou
   vai para o dia seguinte.
6. **Loop/carrossel é outra coisa.** Lista em loop não tem horário fixo; ou é
   regerada por dia a partir de modelo (troca de dia automática), ou fica só
   como preenchimento.
7. **Uma lista no ar por canal.** A tela mostra qual lista/data está no ar;
   sobreposição é recusada ou avisada.

## 4. Proposta

| # | Ajuste | Resolve |
|---|---|---|
| A1 | Mostrar relógio de parede: `HH:MM:SS` do dia + data quando não for hoje (ex.: `16:54:26` / `28/10 00:12:00`) em grade, Master e timeline | P1 |
| A2 | Âncora FIXED/HARD passa a guardar data-hora absoluta; leitura das âncoras antigas convertida para o dia corrente da grade | P2 |
| A3 | Grade em loop: troca de dia automática no início do dia de transmissão (a data acompanha o dia atual), sem perder o item no ar | P1, P2 |
| A4 | Inserir live (biblioteca, "+ Linha", "Programa ao vivo"): diálogo obrigatório com **Início** = Agora (padrão, hora atual) / Horário fixo (padrão: hora atual arredondada +1 min) / Após o anterior, e **Fim** = Duração / Até horário / Manual | P3 |
| A5 | Editar horário: padrão = hora atual quando muda de FLOW para FIXED; campo validado `HH:MM:SS`; horário passado → pergunta "hoje (já passou) ou amanhã?" | P3, P4 |
| A6 | Separar "Fixo (espera)" e "Fixo (corta)" na interface | clareza |
| A7 | Cabeçalho mostra a lista no ar + data; aviso quando duas listas cobrem o mesmo período | P5 |

Ordem sugerida: A1 + A5 (rápidos, sem mexer no motor) → A4 → A2 + A3 (mudam o
modelo de tempo; exigem migração de dados e testes de virada de dia e de
recuperação após queda).

## 5. Implementado (r88-26)

- A1: `apps/web/src/domain/wall-clock.ts` — horário de parede (`HH:MM:SS`, com
  `DD/MM` quando não é hoje) na grade do Master, na Playlist, na linha do
  tempo (régua, playhead, blocos), na barra de transporte, na revisão de
  compensação, no Rundown e nas mensagens de inserção.
- A2: toda âncora criada pela interface é calculada a partir do instante
  absoluto escolhido (hoje/amanhã + HH:MM:SS) convertido para a base da grade.
  Numa grade em loop de 20/10, "17:00 de hoje" grava 7 dias + 17 h — certo.
  Inserção pelo Master com "Horário fixo"/"Horário rígido" usava `at: 0`
  (meia-noite do dia da grade): agora usa a hora atual (próximo minuto).
- A3: não foi preciso rebasear a data da grade em loop: com A1/A2 o relógio e
  as âncoras ficam corretos sem mexer no item no ar. Âncoras antigas (dia
  passado) aparecem com a data delas e, ao editar, o diálogo propõe o mesmo
  horário no próximo dia possível.
- A4: ao vivo vindo da biblioteca abre o diálogo de ao vivo (antes entrava
  como FLOW). Diálogo com Início = Agora / Horário fixo (hora atual + 1 min,
  Hoje/Amanhã) / Após o anterior, e duração. Fim "manual" fica para depois
  (o motor encerra a live pela duração ou pelo TAKE seguinte).
- A5: editar horário abre na hora atual (próximo minuto) para itens sem
  horário fixo; validação `HH:MM:SS`; horário passado pergunta se vai para
  amanhã; botão "Agora".
- A6: tipos renomeados: Sequencial, Horário fixo (a grade se ajusta),
  Horário rígido (corta o anterior), Ao vivo, Preenchimento.
- A7: o Master mostra a grade carregada, a data e "em loop desde DD/MM".
