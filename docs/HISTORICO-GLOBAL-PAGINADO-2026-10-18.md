# 9.1 — Navegação do histórico global do servidor

## Implementação

A tabela global de recursos só mostrava120 registros, mesmo quando o servidor
devolvia até2.000; não havia acesso aos registros anteriores. O painel por canal
já tinha paginação. O novo painel global consulta120 amostras por página e
oferece Registros anteriores, Página anterior, Mais recentes e atualização manual.
Ao navegar, conserva a janela original e suspende atualização automática daquela
página; o cartão de recursos atuais e a consulta por canal continuam independentes.

Servidor e interface usam cursor temporal exclusivo (`before`) com limite
superior fixo (`until`), sem OFFSET mutável. Coletas posteriores não entram na
consulta antiga. Expiração pela retenção pode reduzir a disponibilidade, mas
não muda silenciosamente a janela. Amostra ausente continua N/D, não zero.

Validação de janela/cursor agora é compartilhada pelas duas rotas. Limites
permanecem0,1–336horas/1–5.000amostras; cursor sem limite original, datas inválidas,
futuro e cursor fora da janela são recusados. O controle global de acesso não
foi afrouxado: administrador restrito a canais não recebe recursos globais;
o histórico do seu canal continua disponível sob REPORT_EXPORT e ACL próprios.

Consultas são somente leitura e não disparam coleta, engine, sintonização ou
TAKE. Há cancelamento ao sair/trocar janela, limite de10s por consulta e proteção
contra chamadas periódicas sobrepostas. Não implementa métricas porGPU/saída
nem atribui identidade física a um dado ausente.

Arquivos principais: metric-history-query.ts, routes.ts, api.ts,
HostMetricHistoryPanel.tsx e HostResourcesPanel.tsx.

## Verificação do lote

27 testes em6arquivos PASS, sessão93132/código0: query3, rotas2,
coleta realhost4, retenção transacional4, markup/API global5 e markup/API por
canal9. Cobrem cursor sem duplicar, inserção mais recente excluída, expiração
simulada sem deslocar janela, recusa de cursor inválido, isolamento de ACL,
N/D versuszero, cancelamento encaminhado e navegação na marcação. SSR não
executa os efeitos/cliques reais do React; não afirmar aprovação interativa.

Tipos completos de servidor e interface PASS, sessão96746/código0. Compilações
isoladas PASS; nenhum apps/server/dist ou apps/web/dist existente foi substituído,
pois não foi possível confirmar pela consulta CIM se havia processos utilizando
essas pastas. Destinos novos no workspace:

- `scratch/host-history-r88-20261018/server.cjs`:
  SHA256 `6A94FA681F9ABA36234972E7B969FF2CAD24B16CF70783CB695A1D38E03F6496`.
- `scratch/host-history-r88-web-20261018/assets/index-Bi3UOPSo.js`:
  SHA256 `E15DBFFBD1124CBCCA710B4D2BB8EC9FFCBA17174250CEDF95AD7EB01610649F`.
- CSS index-D7nkMPmZ:
  SHA256 `484542728E8E1B9CB20076B1CE585F03D323212AD790F88FA16C688CCB1A609F`.

Vite avisou sobre chunk grande já conhecido e destino fora da pasta web, sem
limpeza automática. Não foi usado emptyOutDir nem apagado artefato anterior.

## Ensaio HTTP compilado — NÃO APROVADO

`scripts/verify-host-history-pagination.mts` prepara2.413 amostras explicitamente
sintéticas, em banco/cofre próprios, para percorrer21páginas e conferir ACL,
janela/cursor, inserção nova, expiração simulada e parada da própria instância.
Usa dependências Node do projeto explicitamente (NODE_PATH): não é ensaio
standalone, instalado, nativo, de carga representativa ou de retenção prolongada.

`scratch/host-history-http-maeVdb/result.json`: FAIL por timeout de prontidão,
sem diagnóstico de conexão detalhado; preservado. O roteiro recebeu diagnóstico
de startup, sem estender deadlines nem modificar produto.
`scratch/host-history-http-acT8i9/result.json`: FAIL; rastreamento confirmou
main, banco, aplicação e **HTTP listening**, mas o cliente não conseguiu conectar.
Nenhuma página foi qualificada por essas tentativas. Seus próprios processos
Node foram encerrados pelo roteiro; não se alega inventário completo de família,
pois CIM estava indisponível. Engine, broker e relays estavam desativados.

Diagnóstico mínimo separado, servidor HTTP próprio e fetch no mesmo processo,
confirmou `EACCES / connect / 127.0.0.1` (porta efêmera54301). É evidência de
restrição de conexão do ambiente, NÃO aprovação implícita da rota de produto.
Não alterar host/porta/proxy, transporte ou permissões para contornar a recusa.
O teste mínimo encerrou seu listener. Não repetir o ensaio enquanto a condição
persistir. Não foi solicitada nova elevação: o serviço de autorizações já
indicou limite até22/10 na tentativa de build nativa emD:.

Antes da próxima execução, usar `qa-owned-host-history.ps1` para limitar toda
a família futura ao job próprio, incluindo auxiliares de coleta. Wrapper
preparado, ainda NOT_RUN; não tratar flag ou PID histórico como prova de parada.
Preservar FAILs e registrar a nova execução em diretório novo.
Tipos do roteiro final PASS (sessão24300/código0/zero diagnósticos) e sintaxe
PowerShell do wrapper PASS; isso não prova execução/encerramento do job.

## O que falta

9.1 continua em andamento: teste HTTP compilado com conexão autorizada, cliques/
cancelamento/erro em navegador real, validação de engine compilado, correlação
física, carga e retenção de longa duração. Não encerrar53requisitos por testes
de fixtures. Próxima parcial r88 deve incluir ESTE servidor/interface e o engine
corrigido de HELD, não misturar com dist antigo r87. Ainda não existe ZIP r88.
Ao preparar o pacote, compilar ambos nos destinos convencionais somente após
confirmar uso seguro, ou implementar/testar seleção explícita do build web
isolado; o empacotador atual só aceita override do build de servidor.

9.3/10.4 mantêm seus cenários restantes. R87 e instalações anteriores intactas,
sem limpeza/movimentação/GitHub/publicação pública. Grupo8v3, DeckLink física
adiada, sem emissor externo NDI/OMT e sem acordo original de redistribuição NDI.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
