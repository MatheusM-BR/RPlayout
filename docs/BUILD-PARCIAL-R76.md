# RPlayout r76 — parcial instalável para teste interno

Destino previsto: `release/RPlayout-1.1-parcial-20261016-r76-instalador.zip`.
Registrar hash e integridade externamente após a geração, nunca antecipá-los.

Registro externo pós-geração (o README interno permanece o da geração):
540.204.327 bytes; SHA256
`3A2BC3D46BA5B9CC033B96F2153FA496E5749399DBDD5A7FF698A46562332FF0`.
Integridade PASS:7.094hashes/7.095entradas, leitura em memória sem instalação
ou startup. Engine191CD1E1 presente; evidência
`scratch/r76-zip-integrity-20261016/result.json`.

Inclui r75 e corrige áudio incompleto quando preview leve e QC em qualidade
ficam ativos juntos. Os dois encoders não consomem mais a mesma fila: recebem
o áudio do mesmo decoder por tee, cada um em seu canal próprio. O ramo de
áudio QC é limitado sem descartar PCM; o vídeo continua com sua fila econômica.
HQ permanece sob demanda, sem TAKE ou nova abertura da fonte.

Engine novo SHA256
`191CD1E112C7AFBA81896BBF3AA109A100775A7A358B7894FAAAFBE8D1ABDFBC`.
Servidor A709115F e web CD7665DE preservados. Build release locked e oito
testes nativos afetados PASS. Ensaio integrado WFEidE NDI/OMT PASS, conferência
independente PASS: PVW428×240 e HQ640×360 simultâneos com pixels/PCM997Hz reais,
mesmos decoders, HQ desligando sem viewers e PGM parado/grade-asrun0.

Falha visual original XmLjgB e tentativa de fila leaky preservadas; não são
homologações. Replay visual do botão OMT ainda em andamento na geração deste
README. Detalhes `QC-AUDIO-SIMULTANEO-2026-10-16.md`.

Resultado externo posterior: r4h6Yo PASS e conferência independente PASS.
Navegador OMT428×240→640×360→428×240, scopes amostrados e safe desligado;
três capturas nativas com pixels/PCM997Hz estéreo, mesmo decoder1, HQ encerra
readyfalse/0readers ao voltar. Grade/as-run0/PGMparado; aba e processos próprios
encerrados. Não foi repetido o fluxo visual NDI após a correção exclusivamente
de áudio; NDI foi validado no ensaio simultâneo nativo/API acima.

Pacote parcial: Node/módulos de produção/SQLite/engine/runtimes incluídos;
não depende de tsx/tsc/pnpm globais. Instalador/startup desta r76 NOT_RUN.
Overlays sobre r71 e teste sintético não homologam instalação/Windows limpo,
upgrade/rollback, fontes externas, DeckLink, estação remota ou estabilidade longa.
Redistribuição REVIEW_REQUIRED: acordo NDI indisponível; notices não liberam
juridicamente a distribuição. Driver DeckLink externo e teste físico adiado.

Local localhost:4000 (ou porta configurada); remoto IP/nome:porta, por exemplo
192.168.42.172 quando for o IP real do servidor. Sem mudança de rede/firewall,
dados/contas operacionais, limpeza ou migração. Pacotes anteriores preservados.

10 grupos/53verificações:7concluídas/35andamento/4pendentes/7v3 (grupo8).
Não é entrega final homologada nem aprovação de sinal original sem perdas.
