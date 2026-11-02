# Privacidade HTTP, logs e cache — lote do grupo 6.4

Implementado na fonte/servidor compilado, posterior à r66. **6.4 em andamento**,
não encerrada por este ensaio. Nenhuma mudança de conta/configuração operacional
ou instalação, nenhuma nova build instalável e nenhuma limpeza.

## Correções

- Logger de requisição registra método, rota canônica, estação e reqId, não URL
  bruta, query, headers, cookie ou body. Resposta registra só status.
- Erros HTTP não copiam mensagem, stack, causa ou objetos arbitrários ao log;
  mantêm tipo/código reconhecidos, status e correlação. Handler global não usa
  error.message como mensagem de log. 500 não devolve detalhe interno ao cliente;
  fornece requestId/motivo seguro para conferir antes de repetir.
- Fallback404 não registra URL desconhecida. SPA mantém seu único handler;
  sem interface compilada há resposta404 segura, não fallback permissivo.
- Startup conserva diagnóstico de Error sanitizado por política existente,
  sem stack/causas/configuração inteira; campos/URLs conhecidos são redigidos.
  Isso não certifica toda mensagem arbitrária de runtimes externos.
- Backup periódico não imprime caminho completo ou erro/stack bruto. Usa
  logger estruturado com mensagem fixa; códigos técnicos conhecidos preservados.
- JSON/erros/HEAD/exports de controle em `/api` recebem `private, no-store`.
  Mídia binária mantém TTL privado, Content-Range e bytes; são retiradas
  instruções públicas/s-maxage. Assets estáticos web não foram alterados.
  ETags de conferência não são removidos, nem comandos automaticamente repetidos.

## Testes e prova compilada

31 casos distintos: 7 privacidade HTTP, 4 sanitização existente e 20 acesso/
sessões. PASS após correções; replays dirigidos não somados como novos casos.
Tipos servidor PASS; build compilado PASS.

Final: `scratch/http-privacy-YmdGq8/result.json`, PASS/exit0,
servidor A3BF3FC31D517E17770B2CB0D3FB0A4E8AE58200D51C1599543409BA8A25F0AC.
Logger INFO real, Fastify compilado, banco/cofre/usuário/porta próprios.
Engine/broker/dispositivos/relays desativados. Arquivo .mp4 contém oito bytes
artificiais, **não vídeo**: só prova de transporte HTTP206, não ingestão/QC.

Comprovado:

1. Cookie inválido/sem sessão recusado401; login válido e estado autenticado200.
   Senha/hash/token/cookie/queries/caminho desconhecido/body inválido ausentes
   no log, junto aos demais marcadores sintéticos (12 valores verificados).
2. Origem externa negada403 para HTTP e WS; WS de origem própria aberto/fechado.
   Não é homologação CORS de todas as configurações ou de uma estação remota.
3. Controle/erros/HEAD não cacheiam; desconhecido404 sem URL bruta em log,
   JSON inválido400 sem body em log. IDs seguros de erro disponíveis ao operador.
4. Falha real de INSERT de auditoria no login: trigger somente da fixture
   lançou PRIVATE_AUDIT_MESSAGE. HTTP500 sem detalhe privado/cookie e sem nova
   sessão, sessão anterior preservada. Trigger próprio removido depois.
5. Timer de backup acelerado só na fixture (0,0006h), destino próprio sendo
   arquivo: mkdir recusou antes da cópia. Callback real registrou falha sem
   expor PRIVATE_BACKUP_PATH. Não é backup restaurável nem simulação de disco cheio.
6. Mídia por Range recebeu exatamente bytes0–2/8, HTTP206/Content-Range intactos
   e cache privado. Nenhuma aprovação/reprodução inferida desses bytes.
7. Processo/WS/listener próprios encerrados. Banco operacional não foi tocado.

Resultados anteriores preservados: `1ixTMU` PASS do escopo inicial,
`0hzIUN` PASS antes da inclusão do requestId na resposta, `cJgFYA` FAIL de partida.
Não transferidos hashes/escopos antigos ao binário final.

## Falhas encontradas no lote

Primeiro teste encontrou duas cópias ainda expostas pelo próprio framework:
msg do erro e msg404 com URL completa. Serializers sozinhos não bastavam;
handlers seguros adicionados, sem afrouxar a asserção de ausência dos marcadores.
Tipos depois apontaram contrato de serializer e erro unknown; campos constantes
message/stack e normalização explícita corrigidos sem copiar dados privados.

Primeira partida compilada cJgFYA falhou porque dois handlers404 eram registrados
no mesmo escopo (privacidade e SPA). Política agora permite à produção registrar
uma única fallback, com teste desse contrato; startup retomou diagnóstico
sanitizado para não ocultar o motivo técnico. Reexecuções só repararam falhas ou
verificaram alteração real do lote, não mudança de status.

## Ainda falta para concluir 6.4

Auditoria integrada do cofre/configuração/backup e todos os runtimes/auxiliares,
políticas de origem/host e configuração inválida, implantação TLS/acesso remoto,
permissões reais por estação, navegador e pacote instalado. Ausência de runtime
seguro deve continuar recusando execução; este teste HTTP não prova isso para
cada plugin físico. r66 preservada, **não contém este lote de privacidade**.

Total atualizado: 10 grupos/53 verificações —6 concluídas,36 em andamento,
4 pendentes,7 reservadas à v3. Não significa que a segurança está100% homologada.
