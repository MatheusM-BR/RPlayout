# QC de arquivo — áudio no navegador, 16/10/2026

Resultado: **PASS local e amostrado**, não homologação integral de 3.5/3.7.

## Ambiente e evidências

- Acervo, banco, sessão e cache próprios em `scratch/RPlayout-QC-file-browser-YDfvxN`.
- Node/runtimes/web instalados na r71; servidor atual sobreposto explicitamente,
  SHA256 `A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
  Não é instalação ou startup da r76. Engine PGM e MediaMTX desativados.
- Scanner/proxy/probe reais; quatro fixtures continuaram PENDING, vertical
  permaneceu IGNORED por política de ingestão. Nenhuma aprovação foi enviada.
- `workflow-result.json`/`result.json`: hashes do original/proxy, decodificação
  nativa e JPEGs dos quatro arquivos PASS. Este preparo repetiu cobertura já
  existente; não deve ser contado como nova homologação visual dos quatro.
- Nova cobertura: original H264/AAC 640×360 no navegador, versão fixada pelo
  hash `32887586e3f5be26d2d9ef6eb9187341ad20edfea5bd2c7d4dac25e90d33a92c`.
  Observação DOM somente leitura confirmou readyState 4, paused=false e URL
  `quality=original`, não proxy renomeado.
- Verificador `scripts/verify-qc-file-audio-evidence.mjs` releu as observações
  salvas, rastros/raster/posição/hashes de imagens, sem iniciar outra reprodução:
  `assertions-file-audio.json` PASS.

## Comportamento observado

1. Em reprodução do original, pico mostrado −26 dB tanto com volume de escuta
   80% quanto mutado/0%. O medidor pré-fader não foi silenciado pelo monitor.
   Trata-se do pico exibido, não captura PCM separada por canal.
2. Scopes mostraram amostra do player, luma e RGB AMOSTRADO. A cadência
   **configurada/exibida** mudou para 10 Hz em reprodução e 4 Hz na pausa;
   isso não mede a frequência efetiva de todas as atualizações.
3. Pausa em 6,64 s retirou o pico (`—`) sem retirar a imagem inspecionável.
   Retomada voltou a mostrar −26 dB. Cursor avançou desde 0,291 s.
4. Retorno ao proxy real 426×240 preservou a posição (6,930 s já reproduzindo)
   e a amostra de áudio. Interface distinguiu PICOS DO PROXY e PICOS DO PLAYER.
5. Safe area permaneceu OFF, PGM PARADO e nenhum clipe aprovado. A interface
   preservou o aviso de que loudness do original não havia sido medida.

As imagens `original-unmuted-running.jpg`, `original-muted-running.jpg` e
`return-proxy-running.jpg` registram o painel. As observações `*-ax.txt`
registram também os scopes, que ficam abaixo da dobra no viewport usado.
Não se deve alegar que esses screenshots, isoladamente, mostram os scopes.

## Encerramento e limites

Aba criada pelo teste fechada; stop file próprio encerrou o controlador,
sessão terminal exit 0 e servidor próprio com saída observada. O harness usa
encerramento forçado do seu processo de servidor após jobs prontos; isso não
é teste de shutdown gracioso nem prova independente de todos os descendentes.
Nenhuma aba do usuário, dado operacional, configuração de rede ou pacote foi
alterado. Não houve limpeza/movimentação de pastas.

Faltam escuta humana/fidelidade, PCM por canal no navegador, teste prolongado,
estação remota e custo CPU/RAM/rede. Não prova saída física ou emissor externo.
`browserValidated:false` do workflow foi preservado: não representa FAIL deste
recorte, mas evita converter a revisão de áudio em aprovação visual dos quatro
arquivos. Nenhuma mudança de produto neste lote; r76 continua a parcial atual,
sem gerar ZIP idêntico apenas para atualizar status.

## Correção do plano de validação

O resumo atual da matriz ainda pedia genericamente 4:3/vertical/fullscreen,
mas `QC-VISUAL-R58-2026-10-14.md` já registra essas provas locais em u6WVWl;
`QC-FALLBACK-VISUAL-2026-10-13.md` registra o fallback FFV1/anamórfico local.
Esses ensaios não foram repetidos visualmente. A matriz foi reconciliada,
mantendo abertos remoto, combinações não cobertas e medições de desempenho.

Totais preservados: **10 grupos / 53 verificações**, 7 concluídas, 35 em
andamento, 4 pendentes e 7 adiadas à v3. Grupo 3: 2/7 concluídas, 5 em andamento.
