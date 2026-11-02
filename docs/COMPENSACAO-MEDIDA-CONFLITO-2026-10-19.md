# 4.4 — copiar o tempo calculado do conflito para a compensação

## Implementado no fonte

O painel de conflitos do Master agora entrega as medidas do scheduler ao painel
de compensação. Após escolher item e ação, o operador pode copiar diretamente
o tamanho de um conflito, inclusive atrasos de segundos ou2–3minutos. O atalho
não recalcula a grade, não publica rascunho, não envia TAKE e não aplica ajuste.
“Conferir ajuste” e “Confirmar compensação” continuam necessários.

Regras da indicação:

- GAP: valor positivo para estender filler anterior à âncora.
- OVERRUN/ANCHOR_IMPOSSIBLE/ANCHOR_MISSED: valor negativo para reduzir filler
  ou VT anterior à âncora, quando o tipo/flags permitem indicar a ação.
- Aceitar atraso: somente ANCHOR_MISSED da própria âncora flexível SOFT/WINDOW.
  O atalho não desloca FIXED/HARD_TIME nem escolhe outra âncora por suposição.
- Remover opcional não recebe uma duração artificial de redução.
- Item ausente, alvo depois da âncora, live para corte, proteção explícita,
  filler contínuo, medida inválida ou acima de600s não geram indicação.

Uma medida copiada fica congelada como intenção do operador. O número exato
de quadros não passa por arredondamento decimal, inclusive em30000/1001fps.
Atualização de timing durante a live não substitui silenciosamente esse valor.
Editar segundos/item/ação invalida a cópia; mudar a cadência exige nova cópia
ou entrada manual antes da conferência. O controle é desabilitado durante
pedido em curso ou com resultado ainda não confirmado.

Somente medidas de itens anteriores são oferecidas, mas isso NÃO comprova que
o alvo esteja no futuro da execução real. A API existente continua sendo a
autoridade para PGM/CUE, revisão congelada, ocorrência, zonas protegidas,
limites de mídia, autorização, auditoria e deduplicação. Não há novo endpoint,
exceção de segurança ou alteração do engine/timing.

O painel explica que copiar a medida não garante eliminar o conflito. Uma
compensação automática do scheduler já pode alterar a duração executável;
nominal e executável continuam separados na conferência. O cálculo das
indicações é linear no número de itens/conflitos e memoizado. A lista tem
altura limitada e rolagem, sem prometer homologação visual ou latência medida.

## Validação agrupada

72/72testes PASS em8arquivos:

- medidas/quadros/cadência/direção/markup23;
- entrada/presets17;
- âncoras3;
- feedback3;
- seleção3;
- compensação publicada em SQLite21;
- recibo por servidor injetado1;
- marcação do painel1.

Nos testes acoplados, a medida de250quadros copiada na tela chega à conferência
da revisão publicada, reduz VT1000→750 e grava uma única revisão/decisão no
reenvio. O rascunho editorial e a live atual não são alterados. Se o alvo entra
no CUE, a API recusa sem nova revisão. São contratos/SQLite reais, não cliente
HTTP remoto ou confirmação nativa/pixels do ajuste. Flags/zonas/corte limitado
e rollback de auditoria continuam cobertos pela suíte existente do grupo.

Tipos completos da interface e servidor PASS. Fonte servidor/engine não foi
alterado neste lote: não houve recompilação ou repetição da retomada nativa
já conferida. A interface nova ainda não foi compilada/instalada/homologada.
Não se repetiu a tentativa de build sob a mesma recusa EPERM/autorizações,
nem se mudou ACL/política ou escreveu no D:. A r87 instalada não contém este
atalho; r88 continua NOT_BUILT.

## Falta para concluir4.4

Compilar e integrar a interface ao pacote correto; operar o atalho pelo
navegador com atraso variável, PGM/CUE e concorrência; validar o ajuste aplicado
e a percepção de tempo em estação remota. Não fechar4.4 só pela função/SSR.
Permanece também a revisão mais ampla de timing4.2 e live prioritária4.3.

Totais inalterados:10grupos/53verificações —8concluídas,34em andamento,
4pendentes,7adiadas para v3. Estes72testes não são72requisitos encerrados.
