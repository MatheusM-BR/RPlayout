# Retorno HA — análise privada de mídia local

11/10/2026 — implementação em lote, NOT_RUN; fora R55.

Implementados `primaryReturnMediaAdapter`, `returnRequiredMedia`,
`verifyReturnLocalMediaBytes` e `inspectReturnLocalMedia`. São primitivas internas;
ainda falta diário/fila/Store/API/UI de revisão e aplicação da evidência a outra
derivada. Não executar nem publicar com base apenas nessa implementação.

Inventário primário consulta o acervo inteiro por SHA requerido, inclusive mídia
fora da playlist atual, em transação com QC vigente. Consulta em lotes limita
parâmetros; 100 mil ativos/500 mil decisões são limites explícitos, não truncamento
de uma resposta pronta. Aprovação padrão/legada no ativo NÃO substitui decisão
explícita em qc_decisions. Revogação global posterior ao canal vence por rowid.

Só abre caminho retornado pelo acervo local. ID/caminho da reserva não localiza
arquivo. Mesmo SHA com tipo incompatível, mídia ausente, múltiplos candidatos,
links/junções/múltiplos vínculos, arquivo >16 GiB, mudança de identidade/tamanho/
tempo ou divergência de hash impede evidência válida. Ambiguidade requer escolha
local explícita futura, não adotar um caminho estrangeiro nem escolher ao acaso.

SHA antes/depois da sonda; runtime identificado separadamente; um decode por SHA,
mas cortes/trilhas/routing/pares/mixes de cada montagem avaliados separadamente
pelo mesmo inspetor usado pelo HA. Metadado antigo não é prova de decode; análise
técnica não inventa aprovação de QC. Arquivo ignorado continua bloqueado.

Contingências também exigem análise. Lives continuam LIVE_SIGNAL_LOCAL_PENDING;
mix selecionado e grafismos/automação são gates separados. Resultado inclui
reviewCompleted, requiredHashes, verifiedHashes e bytesAndDecodeComplete — não
significam prontidão operacional. publicationAuthorized/operationalReady false.

Resultado é PRIVADO, com caminhos/evidências/maps, e nunca deve ser devolvido
diretamente via HTTP. Novo diário deve cifrar evidência detalhada e expor somente
totais/códigos/IDs sanitizados. Antes de derivar/admitir, revalidar acervo/QC,
configuração, bytes, runtime, plano, aplicação e autoridade. SHA da sonda EXE não
equivale à homologação de todo runtime/DLLs/driver/protocolo.

Cancelamento/sessão/posse devem ser fornecidos pela fila do Store na integração.
Verificação leve nos blocos, revisão completa nas fronteiras; runtime/acervo/QC
e stamps reconferidos ao fim. Índices por hash/ativo evitam varredura quadrática.
Fixtures de requisitos adicionadas, não executadas. Nenhum arquivo/sonda foi
aberto para teste nesta fase.

Próximo: revisão durável ligada à aplicação STAGED, associação do adapter do
principal, relatório sanitizado/consulta na página, seleção local em ambiguidades,
nova derivada validada com mídia/mixes/grafismos/saídas e autoridade/retorno/rejoin.
Totais 10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).
