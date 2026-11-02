# RPlayout r83 — parcial instalável interna

Destino: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r83-instalador.zip`.
Projeto e releases anteriores preservados. Registro pré-geração; evidências e
hash do ZIP serão documentados externamente após a criação.

Inclui r82 (módulos PowerShell vinculados ao PSHOME) e corrige o engine durante
ativação restaurada: destino QC fica retido junto ao PVW até a liberação nativa
explícita. Não cria publisher/superfície HQ no bootstrap retido, não libera PVW
antes do PGM e não aceita destino inválido/duplicado. Sem enfraquecer os gates
de proprietário, concessão, primeiro quadro e confirmação de ativação.

Engine de produção compilado no D:, SHA256
`610E03E8A61215E7DDB85570451178456337B8F2F9AA57AB07A057AE954CF7FA`.
Sete testes nativos afetados PASS (seis QC/configuração/retido + um de áudio
simultâneo PVW/HQ), build release locked/offline PASS. Cache de compilação
copiado para D: para preservar o espaço do C:; código não movido/apagado.
Servidor6B3E024C/launcher101A28C9/web8B0D3FCB preservados, sem recompilar
componentes não alterados. Cargo.lock/dependências não mudaram neste lote.

Backup online r80 IQkjFO PASS. R82 instalada PASS e scripts PS5 corrigidos.
Ensaio TvKSa7 comprovou quarentena/TAKE recusado/recuperação de reserva, mas
ACTIVATE falhou por inspeção exigir preview ausente no preparo retido.
Perfil não adotado; falha e dados preservados. R83 inclui o reparo, ainda
NOT_RUN quanto a instalação/retomada deste pacote no momento deste README.

Não homologa Windows limpo, migração de schema antigo, downgrade/rollback,
hardware, fontes externas NDI/OMT, estação remota ou estabilidade prolongada.
Redistribuição REVIEW_REQUIRED, acordo original NDI indisponível. DeckLink
física adiada; grupo8 reservado à v3. Sem limpeza, migração do projeto,
alteração de firewall, serviços operacionais ou publicação pública.

Matriz: 10 grupos/53 verificações. Consulte o estado pós-ensaio em
PENDENCIAS-NUMERADAS.md. Parcial interna, não entrega final homologada.

## Pós-geração

540.389.724bytes, SHA256
`D9F042EB93FA78678EE89AAE12A24D94CFA56A3681666550E26417AFB09F9F51`.
Instalador real em `D:\RPlayout-builds\qa\r83-installed-20261016`: PASS,
recibo VERIFIED, manifesto materializado e sete destinos de atalhos conferidos.

Retomada instalada r80→r83 em nova cópia de backup: ativação e adoção autenticadas
CONFIRMED, quadro/PCM997Hz e cursor preservado/avançando. Roteiro MLIh8R continua
FAIL pela última expectativa QA errada de as-run único. Conferência independente
PASS com sourceRunResult=FAIL explícito valida o contrato correto de RESTART +
segmento retomado, sem repetir ativação ou alterar o banco. Famílias próprias
encerradas e perfil QA restaurado. Isso não é rollback operacional homologado.
Falhas/limites e evidências em `BACKUP-UPGRADE-R83-2026-10-16.md`.

Totais10/53:8concluídas/34andamento/4pendentes/7v3. 9.3/10.4 continuam abertas;
10.1 identifica artefato atualizado, não homologação final dos demais requisitos.
