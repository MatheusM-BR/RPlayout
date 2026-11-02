# RPlayout r72 — parcial instalável para teste interno

Destino: `release/RPlayout-1.1-parcial-20261016-r72-instalador.zip`.

Registro externo posterior à geração (o README interno do ZIP é anterior):
gerado com 540.199.563 bytes; SHA256
`D01CA4D02A8E230BBB56C5AEBB735663F9CDCCD065665E211296AA305325D6F5`.
Integridade PASS: 7.094 hashes do manifesto / 7.095 entradas, conferidos em
memória sem instalação/execução. Evidência:
`scratch/r72-zip-integrity-20261016/result.json`.

Integra a r71 e duas correções do lote de entradas ao vivo:

- NDI permanece assinada após perda do emissor, em vez de encerrar sua recepção
  pelo timeout padrão do plugin. Ausência de sinal e TAKE sem quadro válido
  continuam protegidos; não se alterou o modo de timestamps.
- Durante a primeira abertura, telemetria sem quadros mantém CUEING/preparação,
  sem declarar que uma fonte previamente adquirida foi perdida. NO_VIDEO e
  falhas reais continuam visíveis; isso não libera TAKE.

Provas dirigidas: 1 teste da configuração NDI + 7 testes nativos de live;
163 testes do transporte + 4 do leitor PCM. Tipos estritos dos leitores e
checagem completa de tipos do servidor PASS. Build do servidor e dos binários
nativos release locked PASS. Servidor SHA256
`E4A01600E18EFC6439C3A87BFCD7D4944B959257412FBF005A85914345A3B619`;
engine `161FB00373BC8791B002157C36E1689EB0F2B00D3DE25F154B8E89041582AFB2`.
Ensaio NDI CTtr22: perda e retorno automático sem outro CUE/reinício de receptor
ou decoder, com imagem nova e tom estéreo novo comprovados. Servidor/web/devices
r71 instalados e engine novo por sobreposição explícita. OMT fVENXc comprovou o
mesmo fluxo com a r71 instalada sem sobreposição. Ver
`RECUPERACAO-NDI-OMT-2026-10-16.md` para falhas anteriores e limites.

Essa evidência não é teste funcional da instalação r72. Instalador/startup r72,
upgrade/rollback, Windows limpo, soak, sinais físicos e estação remota ainda não
foram homologados. Não transferir aprovações r71/overlay para uma nova instalação.

Node, módulos de produção, SQLite nativo, engine e runtimes são incorporados.
Operação não requer tsx, tsc ou pnpm globais. Drivers DeckLink continuam externos;
ensaio físico adiado pelo operador. Localhost local; IP/nome e porta no remoto,
sem fixar o IP do usuário nem alterar sua rede.

Redistribuição: **REVIEW_REQUIRED**, apenas teste interno. Acordo original do SDK
NDI indisponível, demais runtimes/codecs e avisos ainda em conferência. Notices
não equivalem a liberação jurídica. Não anunciar publicação 100% validada.

Nenhuma limpeza, migração C→D ou alteração de conta/dados operacionais.
Pacotes anteriores preservados. Grupo 8 permanece adiado à v3.
Total: 10 grupos / 53 verificações; 7 concluídas, 35 em andamento, 4 pendentes,
7 adiadas à v3. O relatório externo registrará hash/integridade após a geração;
este README interno não pode antecipar o hash do ZIP que o contém.
