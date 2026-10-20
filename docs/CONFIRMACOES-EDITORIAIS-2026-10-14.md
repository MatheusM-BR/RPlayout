# 6.1 — Consultas e confirmações editoriais na página

Lote implementado e com validação parcial dirigida. Não fecha todo o grupo6.
Sem alteração de contas/credenciais, configuração operacional ou hardware.

## Fonte

Categorias: descarte para fechar/reabrir e remoção usam confirmação inline,
desmarcada por ação/revisão. Draft fica congelado durante a confirmação;
manter edição não envia gravação. Mudança de intenção limpa consentimento.
Pastas: retirada mostra seleção/conferência original, exige checkbox e protege
última raiz. Reconferir catálogo invalida a autorização anterior; arquivos e
grade não são apagados pela retirada de raiz.

Integrações: editor/conferências/catálogo/fila têm GET com prazo10s. Poll de5s
não sobrepõe leitura ativa nem cancela consulta manual. Troca de canal/fechamento
cancela consultas antigas; falha de um GET drena seu irmão. Nada disso aborta
PATCH/POST/DELETE. Lista/rascunhos preservados, sem presumir fila vazia.
Descarte/teste/reenvio usam confirmação inline ligada à revisão. Teste permanece
com UUID estável e registro durável, não envio síncrono ou confirmação de saída.
Resposta sem queued/ID/estado não é anunciada como registro confirmado.

Falha de refresh depois de mutação confirmada não sugere reenvio/rollback;
falha depois de uma conferência GET não anuncia gravação. URL privada em draft
não entra na chave de consentimento nem é exibida na confirmação. Autoridade,
revisões, posse incerta/remota, deduplicação e transações do servidor permanecem.

## Testes e limites

38 casos em10 arquivos PASS: prazo/cancelamento/falha/supersessão/drenagem de
GET irmão/poll sem sobreposição; API Unicode/GETsignal e comandos semsignal,
prova/UUID preservados; markup inicial e confirmação desmarcada; wiring fonte
sem window.confirm nos quatro componentes. Wiring/markup não provam interação.
Tipos web PASS após corrigir uma chave JSX faltante no primeiro typecheck;
build web PASS. Não somar os22 casos anteriores aos38 atuais.

UI index-Cc-PfGGg.js SHA256
E80385B2132DF5B9381C6469C58CDD1E0D8511319CE0318414E0A1A680D49FA0.
Fixture própria aHmWLM, backend5F33C58E, engine/broker/probe/saídas desativados.

1. Categoria sintética criada azul; rascunho verde aberto. Reabrir mostrou
   consentimento desmarcado/botão bloqueado dentro da página. Marcar e trocar
   para fechar limpou consentimento; manter edição preservou verde. Confirmar
   nova reabertura descartou somente draft e carregou azul salvo.
2. Peer fez duas gravações same-value azuis em momentos distintos: primeira
   precedeu a abertura do novo rascunho; segunda ocorreu com rascunho verde
   aberto. Esta última invalidou a revisão. Salvar foi recusado na UI, preservou
   verde e bloqueou salvar/remover; reconferir explicitamente voltou ao azul.
   Não houve retry automático nem gravação verde confirmada.
3. Pasta Unicode cadastrada uma vez. Abrir retirada não removeu a pasta.
   Checkbox começou desmarcado; marcar e reconferir lista limpou autorização,
   bloqueou retirada e informou que é necessário escolher de novo. Cancelado.
4. Integrações: catálogo/fila vazios consultados e CONFERIR CADASTRO retornou
   conferência real, sem cadastrar destino ou enviar POST de webhook.

Leitor readonly PASS: scratch/editorial-confirmation-20261014/persisted.json.
Categoriasazul1, CATEGORY_COLOR_CHANGED3 (criaçãoUI1+peers2), MEDIA_ROOT_ADDED1,
API_MUTATION5 (inclui pedido recusado, não equivale a5 commits), SESSION_CREATED3.
Duas raízes preservadas; zero remoção, scan, as-run, integração, entrega e
mutação de conta. Nenhum programa real estava no ar: transporte simulado.
Stop próprio solicitado; fixture exit0/serverExitObserved e aba própria fechada.

Capturas:consentimento-limpo.png,stale-campos-preservados.png e
pasta-confirmacao-invalidada.png na pasta de evidência. Peer primeiro movido
para peer-first-same-value.json; segundo em peer-same-value.json. Não misturar
com WQl8im anterior, cujo peer não foi executado por revisão indisponível.
Nesta execução, novas aprovações normais foram obtidas, sem contornar revisão.

## Falta para fechar6.1

Visual de atraso/erro/poll e dos mutadores de integrações, criação/edição/teste/
reenvio com gateway próprio e comparação de recibos; remoções efetivas e scan
real/probe/falhas; pacote instalado e acesso remoto. Remoções finais não foram
automatizadas pela habilidadecomputer-use, nem alterações de segurança/contas.
Sem homologação DeckLink/NDI/OMT externo/proxy/HTTPS. Grupo8 v3.
Totais10 grupos/53 verificações:6 concluídas/36 em andamento/4 pendentes/7v3.
