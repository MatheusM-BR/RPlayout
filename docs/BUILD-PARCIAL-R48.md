# RPlayout r48 — instalador parcial, não homologado

Inclui r47 e preserva a captura de telemetria quando a leitura dos nomes e
metadados no banco falha. Contexto registra nomes indisponíveis explicitamente;
não descarta o evento nativo nem inventa nome/sinal. Snapshot permanece na fila
de retry se a gravação também falhar. Sem nova migração; engine e web preservados.

Teste dirigido do collector PASS e tipos/build servidor PASS. ServerSHA256
B868E6E881E885B42A60A21378B94D9B57D5C242B315B336B0F4D1E231F65A5A.
Ensaio de perda/retorno com PVW configurado em andamento ao empacotar:
emissor SRT próprio → MediaMTX → decoder RTSP → PVW SRT → leitor RTSP.
Verificar emissor novo, medições novas, incidente/resolução, contexto/ACK,
imagem no PVW e PGM parado. Não usar prontidão de emissor antigo como retorno.
Re-CUE explícito não prova reconexão automática. Homologação física não realizada.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre. Mantém migração48; retorno a pacote antigo não é rollback homologado.
Inclui runtimes portáteis da base anterior; DeckLink requer driver oficial.
Instalação NÃO testada. Não é Setup.exe assinado e não inicia servidor sozinho.

9.2 segue aberto: sinais NDI/OMT/DeckLink, destinos físicos, carga, falha de
armazenamento/crash antes do commit, estação remota e operação prolongada.
Total10grupos:1 concluído/9 abertos;53checks:5 concluídas/24 em andamento/
24 pendentes. Não é entrega final para ir ao ar.

Registro externo após empacotamento (LEIA-ME interno precede o PASS final):
450447001bytes; SHA256
719F3913B42533E7B2D183A01027C2A0880DE8E86CF894AAED21F9536B80C8AC.
Ensaio s0kvze/B868E6E8 PASS ciclo descrito, imagem428x240 antes/depois,
vídeo+áudio novos e recuperação persistida, contexto/ACK preservados, asrun0,
PGM nunca TAKEn e cleanup próprio confirmado. Re-CUE explícito, não prova
reconexão automática. Não homologa inputs físicos/browser/instalação/soak.
