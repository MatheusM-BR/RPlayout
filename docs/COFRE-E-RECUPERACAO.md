# Cofre de credenciais e recuperação em outra máquina (r88-37)

## Por que mudou

Em 03/11 a máquina do ar foi formatada. A chave do cofre estava protegida só
pelo DPAPI do usuário Windows (`vault.json`, proteção `WINDOWS_CURRENT_USER`) e
se perdeu junto. Como o cofre cifrava quase tudo — grade publicada, auditoria,
alertas, snapshots — o backup ficou preso àquela máquina e foi preciso o
`scripts/restaurar-sem-cofre.cjs`, que descarta tudo o que estava cifrado.

A r88-37 resolve as duas causas:

1. **Só credencial é cifrada.** O resto é texto normal e não depende de chave.
2. **A chave é portátil.** Uma senha de recuperação, escolhida pelo
   administrador, embrulha a chave e vai dentro de todo backup.

## O que continua protegido

| Coluna | Regra |
|---|---|
| `guest_keys.stream_key` | sempre cifrada |
| `destinations.url` | sempre cifrada (a chave de stream fica no caminho da URL) |
| `integrations.url` | sempre cifrada (o token do webhook costuma ficar no caminho) |
| `live_sources.srt_config` | sempre cifrada (passphrase SRT) |
| `output_profiles.target`, `transmission_presets.target` | cifrada quando há credencial |
| `live_sources.target_url`, `rundown_items.source_ref`, `rundown_items.live_endpoint` | cifrada quando há credencial (passphrase, usuário/senha); NDI/OMT e caminhos ficam em claro |
| `integration_deliveries.target` | cifrada quando há credencial |

"Quando há credencial" segue `containsCredential` (`apps/server/src/domain/credential-detection.ts`):

- usuário/senha na URL;
- parâmetro `passphrase`, `streamid`, `key`, `token` etc.;
- RTMP com caminho;
- HTTP com caminho ou consulta;
- `Bearer`;
- chave JSON `passphrase`, `streamKey`, `password`, `token` etc. com valor.

Na dúvida, o valor conta como credencial e fica cifrado.

## O que passou a texto normal

Estas colunas agora ficam em texto normal:

- grade publicada (`operational_playlist_revisions.payload`);
- snapshots de projeto;
- eventos secundários;
- células do multiview;
- conversões de cadência;
- payload de entregas de integração;
- mensagem e contexto de alertas (`health_events`, já mascarados pelo diagnóstico);
- auditoria nova (`operator_decisions.payload`).

Regra de segurança mantida: se um desses valores **embute** uma credencial, ele
continua sendo gravado cifrado. Isso acontece, por exemplo, com um snapshot de
projeto que inclui as chaves de stream dos convidados, ou com uma grade cujo
item ao vivo tem passphrase SRT no endpoint. Assim nenhuma chave de stream vai
para o banco em claro por tabela.

O contexto AAD de cada envelope continua `rplayout:<tabela>.<coluna>`; nada
foi renomeado.

## Migração 58 (`credential-only-vault-and-recovery`)

Aditiva. Roda na primeira partida e faz o seguinte:

- Abre, com a chave atual, os envelopes que não são credencial e grava o
  texto em claro.
- Cria a tabela `vault_recovery`.
- Retira os gatilhos de revisão das tabelas tocadas (contadores editoriais,
  de configuração, de projeto) e os recria com o mesmo texto, dentro da mesma
  transação. Trocar a codificação de um valor não é edição: não invalida a
  grade publicada nem os ETags.
- **Não reescreve `operator_decisions`.** A auditoria é append-only (gatilhos
  de imutabilidade e de comandos de grafismo) e os selos de segurança são hash
  do valor gravado. O histórico antigo continua cifrado e abre com a chave,
  que agora é recuperável; os registros novos já nascem em claro.

O verificador de backup (`validateDatabaseSecrets`) autentica todo envelope
de qualquer coluna que já foi protegida. Ele recusa o backup se encontrar
uma credencial em claro.

## Senha de recuperação

Na tela técnica (Recursos do servidor), o cartão **Cofre de credenciais**
mostra o estado:

- **Sem senha:** aviso permanente "Backup não restaurável em outra
  máquina".
- **Definir/trocar:** só ADMIN. Exige a senha da própria conta
  (reautenticação) e `If-Match: "vault-recovery:<revisão>"`. Mínimo de 12
  caracteres.
- **Rotas:**
  - `GET /api/engineering/vault-recovery`: status sem segredo;
  - `PUT /api/engineering/vault-recovery`.

Como funciona por dentro:

- A chave de 32 bytes é embrulhada com scrypt (N=2^17, r=8, p=1, ~128 MiB)
  e AES-256-GCM. O AAD amarra o custo e a impressão da chave.
- O registro embrulhado fica em `vault_recovery`, dentro do banco, então vai
  junto em todo backup. Uma cópia fica em `vault-recovery.json`, na pasta de
  dados.
- A senha nunca é gravada. Ela não vai para log, URL, banco, auditoria (só
  `VAULT_RECOVERY_PASSWORD_SET` com a revisão) nem para nenhuma resposta.
- Senha errada ou registro adulterado dão sempre o mesmo erro genérico.

**Guarde a senha fora da máquina do ar.** Sem ela e sem o `vault.json`
original, as credenciais de um backup não abrem.

## Como restaurar em outra máquina (ou outro usuário Windows)

1. Instale o RPlayout na máquina nova.
2. Grave a senha num arquivo temporário. Você também pode usar a variável
   `RPLAYOUT_RECOVERY_PASSWORD`, ou deixar o script perguntar com digitação
   oculta. A senha **nunca** vai por argumento de linha de comando.
3. Rode:

   ```powershell
   .\restore-rplayout-backup.ps1 -Backup D:\Backups\rplayout-....db -Destination D:\Recuperado -RecoveryPasswordFile C:\temp\senha.txt
   ```

   Ou chame direto `restore-backup.cjs --backup ... --destination ... --recovery-password-file ...`.
4. A ferramenta faz o seguinte:
   - abre a chave embrulhada dentro do backup;
   - confere o backup inteiro com ela;
   - cria a pasta nova em quarentena;
   - grava `vault.json` **re-embrulhado pelo DPAPI do usuário atual**;
   - grava `vault-recovery.json` ao lado.
   O relatório sai com `vaultMode: "RECOVERY_PASSWORD"`.
5. Aponte `RPLAYOUT_VAULT_FILE` para o `vault.json` novo (ou copie-o para
   `%LOCALAPPDATA%\RPlayout\security\vault.json`) e siga o fluxo normal de
   quarentena/revisão da restauração.
6. Apague o arquivo temporário da senha.

## Assinaturas HMAC

Estes registros são assinados com HMAC:

- posse de execução e de distribuição;
- admissão do armazenamento;
- instâncias do servidor;
- recibos de restauração.

As chaves desses HMACs já são derivadas da mesma chave de 32 bytes do cofre
(`reviewIdentity`, domínio `rplayout:review-key:v1`). Por isso a senha de
recuperação também as recupera. Não foi preciso criar uma "chave de
instalação" separada: com a chave recuperada, as assinaturas do backup
conferem na máquina nova. O que continua preso à máquina antiga é proposital
e não depende de chave: identidade de processo, posse do PGM e retomada de
execução. Isso continua passando pela quarentena e pela revisão da
restauração.

## Quando não há senha nem cofre

O `scripts/restaurar-sem-cofre.cjs` continua funcionando para backups antigos
(r88-35, migração 57), com o mesmo resultado de antes.

Em backups r88-37 ou mais novos, ele apaga só o que ainda está cifrado:

- credenciais;
- histórico antigo da auditoria, com os selos;
- outros envelopes.

Mantém o que já está em claro e apaga o `vault_recovery` da chave perdida.
O servidor cria um cofre novo na partida. Cadastre a senha de recuperação
logo em seguida.

## Riscos conhecidos

- O registro de recuperação viaja com o backup. Quem tem uma cópia do backup
  pode tentar força bruta offline contra a senha. O scrypt caro reduz o
  risco; a senha precisa ser longa e única.
- `operator_decisions` antigo continua cifrado (append-only). Sem chave nem
  senha, só o restaurar-sem-cofre o descarta.
- Outros envelopes internos continuam usando a chave:
  - relatórios de backup de atualização;
  - origem de restauração HA;
  - `sealedSource` do vínculo ao vivo.
  Eles também são recuperados pela senha.
