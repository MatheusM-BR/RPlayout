# Pendências de entrega — RPlayout 1.1

## Em execução

- [ ] Programação persistente por data e calendário diário/semanal.
- [x] Workspace de playlist separado visualmente do Master, com publicação protegida pela sessão/permissões.
- [x] Recomendações inteligentes auditáveis e aprováveis: cada item mostra categoria, último horário no ar e preferência aprendida antes da aplicação.
- [ ] Agulha real de posição no PVW e sincronização quadro a quadro.
- [ ] Teste físico de áudio, NDI e SDI.
- [ ] Instalador self-contained e teste em máquina limpa.

## Concluído e validado

- [x] PGM e endpoint MediaMTX com áudio SRT/Opus.
- [x] Importação de playlist pelo explorador.
- [x] Revisão, ordenação e remoção de entradas.
- [x] Preenchimento automático por minutos e horário final.
- [x] Visão diária e exportação CSV.
- [x] Aired, auditoria, usuários e permissões básicas.
- [x] Processos por canal e uso.
- [x] Painel de usuários com login, papéis e ativação/desativação.
- [x] Painel unificado de saídas e processos.
- [x] Seek visual abaixo dos monitores PGM e PVW.
- [x] Bloqueio PGM fixado.
- [x] Cache de build desativado.
- [x] Typecheck, build web, testes TypeScript e testes Rust.
- [x] Smoke test do engine: três takes, PGM e PVW com áudio real confirmado.

## Ordem de execução

1. Persistência/calendário.
2. Workspace isolado e permissões de publicação.
3. Automação inteligente explicável.
4. Agulha real de vídeo.
5. Testes físicos e instalador.

## Bloqueios externos

- NDI/SDI e validação de placa precisam de hardware conectado; não podem ser simulados com segurança pelo ambiente de desenvolvimento.
- O launcher ainda depende de Node.js/pnpm. Para uma instalação realmente self-contained é necessário distribuir um runtime Node compatível ou substituir o servidor por um binário empacotado.
