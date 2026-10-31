# 6.3/6.4 — Contas, sessões, auditoria e diagnósticos integrados

Lote na fonte posterior à r67. Não altera banco/contas/configuração operacional
nem prova vídeo físico. Grupo6 permanece aberto; não houve novo ZIP por mudança
de status. A r67 contém o lote anterior de HTTP/Host, não esta correção posterior.

## Correção do lote

Todas as capturas de erro em index.ts usam objeto{err} e contexto fixo: ingestão,
acervo, mídia, áudio, continuidade, publicação, distribuição, cache, incidentes,
expiração, avisos do scheduler e as-run. Antes, um aviso usava{error}, fora do
serializer privado, e capturas de unknown podiam tratar uma string como msg.
Não basta testar logs HTTP para certificar esses caminhos de fundo.

O serializer retém códigos SQLite conhecidos de trigger/check/not-null/chave
primária para diagnóstico, nunca texto arbitrário, causa ou stack. Mantidos
horários, política de retry, transações, comandos e guards existentes.
Não há fallback permissivo nem retry automático de mutadores.

## Verificações deste lote

139 casos automatizados PASS em10 arquivos: contas/conferências/bootstrap,
revisões, permissões, acesso/papel padrão, auditoria, expiração e privacidade.
Inclui caso novo de logger real com Error/string/objeto privado em tarefas de
fundo; códigos/contextos técnicos preservados sem repetir valores privados.
Tipos servidor e build compilado PASS.

Os três ensaios abaixo executaram o mesmo servidor compilado:
SHA256 5F33C58E58E2D26294FAD3EFF71F994C82D093AE0F6159DAC91BDE8508A64607.
Não são três homologações independentes do produto inteiro.

| Prova | Resultado observado | Evidência própria |
| --- | --- | --- |
| Expiração HTTP/WS/auditoria | Falha de trigger preserva sessão expirada/zero auditoria; diagnóstico fixo+SQLITE_CONSTRAINT_TRIGGER, sem texto privado. Após reparar/reiniciar, uma expiração auditada. Expiração controlada recusa HTTP e fecha WS4401; limites de login aplicados. | Temp/RPlayout-auth-role-boundary-hrg0Kb/result.json e server.log |
| Contas e sessões em dois servidores | Um vencedor concorrente; escrita cega/stale/ABA/campos extras recusados; último admin preservado; sessão nova invalida conferência; cinco falhas de auditoria revertem alterações e não emitem cookie de logout; revogação fecha dois WS4401; revisões persistem após restart. Backup integrity/foreignKeys ok. | stdout exit0 de verify-account-reviews.mts, fixture Temp/RPlayout-account-reviews-BhAzZt; captura resumida no scratch abaixo |
| Papéis e sessão atômica | Papel persistido inválido recusa login/leitura sem novo cookie; WS4401; falha de auditoria de login não cria sessão; sessão válida sobrevive restart; papel local inválido não é elevado por header. | Temp/RPlayout-auth-role-boundary-FvhaxY/result.json e server.log |

Temp acima é C:/Users/fsda/AppData/Local/Temp nesta execução. Provas em scratch:
group06-security-integrated-20261014.json, captura de resultados/exit0 observados,
sem tokens, hashes de senha ou conteúdo de banco operacional.

Servidores/WS/listeners próprios encerrados, conforme retorno dos três scripts.
O ensaio de contas preserva PGM/PVW/startedAt **simulados**; não comprova
preservação de decoder/quadro real. Expiração usa data controlada no banco,
não uma espera de12h. Backup desse ensaio valida estrutura SQLite, não restauração
operacional de um canal. Nenhum pacote instalado ou navegador foi testado aqui.

## Falta para fechar o grupo

6.1: integração/visual das interfaces editoriais de categorias, raízes/scan e
integrações.6.2: fluxo completo dos comandos operacionais restantes, com estados
de aceitação/execução/falha.6.3: fluxo visual completo de contas/sessões e acesso
por estação/canal.6.4: auditoria/credenciais integradas com todos os fluxos,
proxy/HTTPS/navegador remoto real e configuração de runtime.6.5: diagnóstico/
recuperação integrados nas interfaces e pacote. Não foi relaxado nenhum desses
gates por os ensaios locais terem passado.

Não houve limpeza, teste DeckLink ou conexão ao IP192.168.42.172. Grupo8 v3.
Total10 grupos/53 verificações:6 concluídas,36 em andamento,4 pendentes,7v3.
139 casos automatizados são casos de teste, não novas verificações da matriz.
