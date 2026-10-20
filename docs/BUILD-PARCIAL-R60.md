# RPlayout r60 — parcial de teste, não homologada

QA audiovisual de arquivo PASS em scratch/RPlayout-ingest-qc-take-WitzMo:
scanner/probe/proxy reais, servidor/engine/MediaMTX da instalação, PATH mínimo.
CUE entregou imagem publicada RTSP320x180 (desvio17,789, não quadro preto)
sem mudar origem do PGM. TAKE implícito do CUE bloqueado por QC ou perfil
incompatível preservou PGM e seleção. Reaprovação permitiu TAKE nativo;
as-run confirmado com hash da mídia/revisão publicada. Família de processos
própria encerrada pelo harness. Não comprova browser, live ou saída física.
NOT_RUN audiovisual abaixo é histórico superado apenas neste escopo de arquivo;
conferência visual da seleção, estação remota e Windows limpo permanecem abertas.

QA posterior: instalação integral PASS em scratch/r60-installed-qa-20261014,
recibo VERIFIED; sete atalhos com alvo/diretório existente dentro dessa edição.
Servidor instalado PASS2395ms com Node incluído/PATH mínimo e banco próprio:
scratch/RPlayout-portable-server-XvC0Si/result.json. Interface atual200,
index-xcL5h0FB.js SHAedec9b8fa3c9d9fe4200590f1de0f7a4e685d600a0808bb15f491e3383ecf632.
Encerramento observado. Engine/PGM desativados neste smoke; sem Windows limpo.
Tentativa anterior Evw8D5 terminou FAIL por fetchEACCES da sandbox; preservada.
Novo ensaio com autorização de rede loopback PASS, sem reiniciar sessão ativa.
NOT_RUN de instalação/startup abaixo é histórico superado por este registro;
teste funcional audiovisual e conferência visual da seleção ainda não executados.

Pacote gerado:release/RPlayout-1.1-parcial-20261014-r60-instalador.zip,
540171834 bytes. SHA256
BE10595F6D1B9BA14812B93BBE1D4CED3275F46D370658238517472100642BEF.
Integridade PASS:7095 entradas,7094 arquivos com tamanho/hash conferidos;
scratch/r60-zip-integrity-20261014/result.json. Compilações servidor e engine
release --bins --locked PASS. Não comprova instalação/startup/hardware.

Integra o lote da r59 e corrige a seleção obsoleta no painel de compensação:
itens retirados da lista não habilitam conferência/confirmação nem exibem
revisão antiga. Solicitações incertas preservam identidade e consulta;
recibos não são apagados pela retirada do item.

Lote frontend:27 testes PASS e TypeScript PASS. Build web PASS,
asset index-xcL5h0FB.js. Sem nova prova visual dessa correção.
Instalação, startup e ensaios funcionais desta edição ainda NOT_RUN.
Provas de edições anteriores não equivalem à validação desta edição.

Runtimes portáteis e avisos são incluídos, mas redistribuição final ainda
REVIEW_REQUIRED: termos NDI/MSVC, abstract-logging e revisão de codecs.
Sem emissores externos NDI/OMT disponíveis. DeckLink física adiada.
Grupo8 fica para v3. Nenhum teste HA executado neste lote.

Totais:10 grupos/53 verificações;6 concluídas,35 em andamento,
5 pendentes,7 adiadas para v3. Bancos operacionais e releases preservados.
