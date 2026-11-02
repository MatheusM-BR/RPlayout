# Preview local após admissão HA — NOT_RUN

Posterior à R55, sem testes/build/encoder/rede/hardware neste lote.

Perfil `candidate.localOutputs.preview` passa à configuração privada do engine
cercado, com geometria/cadência/bitrate leves já conferidos no plano. Channel
com holdProgramOutputs não constrói publicador PVW no startup. Novo Ready
previewAdmission obrigatório quando há Preview retido; engine antigo recusa
preparo, sem fallback que abra antes da admissão.

Após release PGM/prova/accounting/manutenção, orquestrador chama releasePreview
do decoder. Comando nativo ReleasePreviewOutput leva somente owner/term, usa
destino congelado e exige PGM liberado/preview ainda não construído, com cerca
validada antes/depois. Node exige mesma geração/concessão, guarda envio único,
ACK e autorização atual; falha fecha apenas processo próprio, sem reenvio.
PVW segue on-demand/software/até 240p e 15 fps; não entra full-resolution.

Abrir publicador não prova entrega nem sintoniza automaticamente uma entrada.
Restam roteamento de monitor/painel/canal/MediaMTX na execução promovida e
qualificação de tráfego/sinal. Não equivale a QC em alta qualidade. Nenhuma
mudança de destino posterior é autorizada por esse comando. Fixtures NOT_RUN.
