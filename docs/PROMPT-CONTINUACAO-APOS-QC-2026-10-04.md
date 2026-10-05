# Checkpoint após QC e prompt de continuação

Encerramento desta etapa solicitado pelo operador em 04/10/2026, às 20h BRT.
O trabalho fica pausado, não concluído integralmente. Não há publicação final
100% validada nem pacote portátil final correspondente a este checkpoint.

## Estado preservado

Manter todas as alterações anteriores do projeto. O diretório possui muitas
modificações e arquivos não rastreados: não usar reset, clean ou restauração
em massa. A matriz histórica está em `docs/IMPLEMENTACOES-BROADCAST-2026-09-30.md`;
ler as etapas mais recentes antes de tratar pendências antigas como atuais.

O ponto de parada é UI-04 + SEC-20, incluindo:

- Preview leve por padrão; QC com inspeção de maior qualidade sob demanda,
  áudio opt-in, leases por janela e safe area desativado por padrão.
- Inspeção live vinculada à fonte preparada, sem TAKE automático. Caminho
  de maior qualidade antes da redução do PVW, sem uma terceira conexão à fonte.
- Decisão QC vinculada à revisão do ativo, hash, canal e configuração conferidos;
  concorrência/ABA/quarentena invalidam a revisão anterior.
- Alteração de perfil QC com revisão explícita; auditoria e alteração na mesma
  transação; falha de auditoria reverte decisão e contadores.
- Interface preserva rascunhos em conflito, exige reabertura explícita e evita
  respostas antigas após troca de ativo/canal. Corrigido falso sucesso ao rejeitar.
- Migração 23 e validação das proteções QC no startup e na restauração de backup.

A proteção adicional de restauração de projetos foi apenas iniciada após QC.
Seu scaffold foi retirado nesta pausa: excluídos somente os novos arquivos
`apps/server/src/db/project-revisions.ts` e
`packages/protocol/src/channel-projects.ts`, suas referências e tabela de schema.
Não houve aplicação dessa migração 24 ao banco. O domínio de projetos existente
foi preservado. O diagnóstico abaixo não equivale a uma correção implementada.

## Evidência e limites de validação

- Rodada completa SEC-20: 166 arquivos, 1.373 testes aprovados em 04/10,
  início 19h58m57 BRT, duração 62,60s. Tipos e build aprovados naquela etapa.
- Após retirar o scaffold: tipos aprovados; 56 testes aprovados em 6 arquivos
  (QC, backup, banco e projetos/rotas operacionais), início 20h12m24 BRT.
  `git -c core.safecrlf=false diff --check` aprovado. Não houve uma nova rodada
  completa nem uma nova build nesta pausa.
- Verificador QC com dois servidores compilados e SQLite isolado:
  `scripts/verify-qc-reviews.mts`, evidência em
  `C:\Users\fsda\AppData\Local\Temp\RPlayout-qc-reviews-hnJK7a`.
  Concorrência, revisão cega/stale, reinício, hash ABA, mudança de perfil,
  quarentena global, três rollbacks de auditoria e restauração de backup passaram.
  Transporte SIMULATED e mídia placeholder: não comprova decodificação/aprovação
  de vídeo, navegador, replicação ou saída física.
- Verificador live QC anterior: `scripts/verify-qc-live-quality.mts`, evidência
  em `C:\Users\fsda\AppData\Local\Temp\RPlayout-qc-live-quality-YDoso1`.
  Loopback nativo: entrada 1280×720/25, preview leve 428×240, inspeção 1280×720,
  áudio Opus decodificado, dois viewers, expiração e PGM preservado.
  Não comprova navegador, fonte NDI/OMT/DeckLink externa nem operação física.
- Testes nativos 72 aprovados/1 OMT ignorado pertencem à UI-04 anterior;
  não foram repetidos na SEC-20 ou nesta pausa.

Artefatos preservados e hashes SHA-256 conferidos nesta pausa:

- `apps/server/dist/server.cjs`:
  `290425D74E37B48054FDC3DA1B2AF4050BE6A2F9E0806737C728DD694ECE4177`.
- `apps/engine/target/release/rplayout-engine.exe`:
  `5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009`.
- Web: `index-ohG5_16B.js` e `index-BBx7O8R5.css`. Permanece aviso de chunk
  de aproximadamente 925 kB; testes aprovados não comprovam desempenho final.

QA 4041 não foi atualizado/reiniciado nesta pausa. Última evidência registrada:
PID 14372 desde 18h43m57, backend anterior às novas guardas QC, canais simulados,
zero engines nativos e MediaMTX desativado. Não assumir que PID/portas continuam
iguais ao retomar. Servir arquivos web novos não atualiza um backend em memória.
Uma tentativa anterior de atualizar esse processo foi bloqueada por política;
não contornar por outro comando ou mecanismo. A automação de navegador também
teve bloqueio anterior; não substituí-la por bypass headless.

## Pendências para continuação, em ordem prática

1. **Restauração de projetos e alterações compartilhadas.** Revisar
   `apps/server/src/domain/channel-projects.ts`, rotas, SettingsView e testes.
   Captura atual faz consultas assíncronas sem snapshot único; captura/auditoria
   não são atômicas. Restauração valida fora da transação e um upsert de rundown
   pode atingir ID de outro canal se o payload tiver dono/ID incompatível.
   Esses são diagnósticos de código, ainda sem ensaio adversarial completo.
   Implementar prévia de impacto e revisão original conferida; autorização fresca
   no commit; validação completa de dono, IDs e referências antes de qualquer
   remoção/upsert; transação e auditoria atômicas; isolamento entre canais e
   preservação de publicações/as-run. Usar o mecanismo durável existente de
   configuração/fencing; não replay de comandos nem TAKE automático.
   UI deve preservar rascunho e rejeitar respostas de canal/revisão antigos.
   Conferir migrações reais antes de escolher número novo. Atualizar os ensaios
   dependentes da API, inclusive `verify-device-automation.mts`, sem perder cobertura.
2. **Demais guardas e auditoria.** Mapear mutadores ainda sem contrato suficiente
   (metadados/título/categoria, remoção/prune do acervo, templates, administração,
   integrações e fontes live). Manter revisão original, permissão reconferida,
   auditoria atômica e distinção entre commit realizado e aplicação no engine.
3. **Banco operacional separado.** SQLite/WAL ainda está no processo do backend.
   Projetar e implementar serviço/worker separado com contrato, falhas,
   recuperação, consistência multiusuário e latência medida. Dois processos
   lendo o mesmo SQLite em teste não comprovam separação nem redundância.
4. **HA executável de ponta a ponta.** Existem checkpoints, mídia privada,
   testemunha/grants/fencing, restauração isolada e probe local. O reserva continua
   bloqueado para promoção (`promotionReady`/`failoverReady` falsos).
   Faltam promoção sob grant com bindings locais de placa/saída revisados,
   QC/mídia/trims/mixes/live no reserva, handoff, replicação reversa, rejoin,
   failback e fencing externo. Homologar falha física de host/rede/OS e medir
   RPO/RTO; não declarar hot standby por simulação local.
5. **DeckLink, NDI e OMT físicos.** Diferenciar plugin/runtime, driver, enumeração
   de placa e entrada sem sinal. Ensaiar placa real e versões de Desktop Video;
   NDI/OMT reais em recepção/publicação, ABI, áudio, estabilidade e reconexão.
   OMT não é SMPTE-2110/NMOS. Verificar CUE prepara PVW, TAKE usa o item cued
   somente após quadro válido e falha preserva PGM; Próximo continua distinto.
   Ensaiar QC direto sem passagem pelo Master e ausência de piscadas/trocas
   indevidas. Também faltam homologações físicas ATEM/GPIO quando aplicáveis.
6. **Operação remota e interface.** Homologar navegador remoto com WHEP, áudio,
   scopes, latência/CPU/rede e inspeção QC em qualidade sob demanda. Conferir
   preview maior, overlay safe area dentro do vídeo 16:9 e desligado por padrão.
   Seletor de pasta deve ser HTML na página remota navegando arquivos do servidor,
   sem diálogo do SO do host; testar caminhos Ç/Ã/Ó e normalização Unicode.
   Nome da input deve ficar abaixo da seleção e assumir a fonte NDI/OMT/etc.
   selecionada, com edição manual consistente. Não reescrever cegamente recursos
   existentes: identificar regressão e validar fluxo real.
7. **Timing/live prioritário e mídia.** Confirmar live marcada visível e corte
   prioritário do VT no horário; conflito e ações rápidas para atrasos de segundos
   ou 2–3 minutos; auditoria e compensação do restante. Validar ingestão durável,
   versões, proxies, QC por perfil, aprovação/bloqueio, tracks, mixes e trims em
   execução. Em Ignorados mostrar só vídeos. Importação de qualquer formato de
   vídeo foi indicada pelo operador para v2.5: preservar esse horizonte e explicitar
   formatos efetivamente testados, sem prometer todos nesta versão.
8. **Soak, recuperação e observabilidade.** Ensaios prolongados e falhas de engine,
   banco, saídas/rede e energia; métricas históricas CPU/GPU/RAM/disco/rede,
   incidentes persistentes e reconhecimento; limites objetivos para sinal preto,
   freeze, silêncio e recuperação. Revisar pendências da matriz de segurança,
   acesso/sessões/segredos e restauração real, sem confundir backup gerado com
   serviço recuperado. Otimizar e medir o bundle/scopes/áudio se necessário.
9. **Pacote Windows final e publicação.** r21/r22/r23 foram preservados; r23 é
   anterior ao QC mais recente e a outras mudanças HA, não é a entrega final.
   Gerar pacote novo com Node embutido, servidor compilado (sem tsx/tsc em produção),
   módulos de produção materializados, better-sqlite3 com ABI correto e runtimes
   nativos redistribuíveis compatíveis. Ensaiar Windows limpo sem Node/npm/tsc/tsx,
   módulos ou GStreamer globais. Driver DeckLink instalado segue requisito de
   hardware; não prometer eliminá-lo. Preservar dados/cofre da instalação,
   testar backup/restauração/upgrade e verificar manifesto/hashes e engine
   realmente carregado. Só então avaliar publicação, sem alterar releases antigas.

## Comandos de verificação na retomada

Preparação do envio ao GitHub solicitada em 05/10/2026: nova conferência de
tipos PASS e suíte completa 166 arquivos/1.373 testes PASS (59,78s).
Sem nova build, homologação física ou retomada das implementações pausadas.
Dados locais, credenciais, caches e mídias não fazem parte do commit do projeto.

Executar no workspace após conferir ambiente e mudanças; scripts usam fixtures
isoladas, mas dependências/portas precisam ser verificadas antes da execução.

```powershell
pnpm typecheck
pnpm exec vitest run
pnpm build
node apps/server/node_modules/tsx/dist/cli.mjs scripts/verify-qc-reviews.mts
node apps/server/node_modules/tsx/dist/cli.mjs scripts/verify-qc-live-quality.mts
git -c core.safecrlf=false diff --check
```

As builds acima são servidor/web, não rebuild do Rust. Scripts nativos exigem
engine/SDK/runtime disponíveis; conferir hashes e compatibilidade primeiro.
Reexecutar os outros verificadores específicos à alteração, registrar falhas
e tentativas de reparo, e não atribuir resultado antigo a artefato novo.

## Prompt pronto para retomar

```text
Retome o RPlayout no workspace C:\IA\RPlayout após a pausa do QC em 04/10/2026.
Leia integralmente docs/PROMPT-CONTINUACAO-APOS-QC-2026-10-04.md e as etapas
mais recentes de docs/IMPLEMENTACOES-BROADCAST-2026-09-30.md. Preserve o escopo
do relatório anotado e dos pedidos anteriores. A pausa encerrou apenas a etapa,
não concluiu o objetivo integral. Retome o objetivo pausado conforme o mecanismo
do produto, sem criar outro para ocultar as pendências.

Inspecione o estado atual do código, instruções do projeto, migrações, builds e
processos. Preserve todas as mudanças e dados existentes; não use reset/clean,
não faça TAKE ou publicação automática, não sobrescreva releases antigas nem
contorne bloqueios de política. O QA4041 registrado estava com backend antigo:
não o trate como prova das novas funções nem reinicie sem conferir o contexto.

Comece pela restauração segura de projetos: prévia e revisão conferida,
permissões frescas, validação de IDs/donos/referências, isolamento entre canais,
transação/auditoria atômicas e proteção de publicações/as-run. O scaffold pós-QC
foi retirado: não está implementado e não deve ser presumido como migração aplicada.
Conclua essa frente com testes adversariais e ensaio compilado antes de avançar.

Depois percorra uma a uma as pendências documentadas: demais guardas do acervo
e configuração, banco separado, HA com promoção/handoff/rejoin/failback e fencing,
hardware DeckLink/NDI/OMT, fluxos CUE/TAKE/Próximo/QC, input com nome derivado da
seleção e campo abaixo dela, pasta remota HTML/Unicode, live prioritário e timing,
ingestão/mídia/QC, observabilidade/segurança/backup, soak e pacote Windows final.
Mantenha Ignorados restrito a vídeos e respeite a indicação de todos os formatos
para v2.5. No QC preserve preview leve por padrão, botão de maior qualidade,
áudio opt-in e safe area desligado e limitado ao vídeo.

Atualize a matriz por requisito com evidências, hashes, testes, falhas e limites.
Distinga testes unitários/HTTP, simulação, loopback nativo, navegador remoto e
hardware real. Não declare 100% ou estime percentual por quantidade de testes.
Se a homologação exigir hardware/acesso/autoridade indisponíveis, explicite a
pendência e peça o necessário; não simule essa prova. Ao concluir, produza e
valide novo pacote portátil em Windows limpo, preservando dados e segredos,
e entregue o que estiver comprovadamente pronto com as limitações restantes.
```
