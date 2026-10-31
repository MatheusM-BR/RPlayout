# Licenças — inventário do pacote r88-23 (27/10/2026)

Não é parecer jurídico. Base: instalação de QA da r88-23
(`D:\RPlayout-builds\qa\r88-installed-20261027-041242`), `package-manifest.json`
e o histórico em LICENCAS-PACOTE-R57.md e NDI-TERMOS-LOCALIZADOS-2026-10-19.md.

Uso declarado pelo usuário em 19/10: **interno e testes, sem distribuição**.
Para uso interno quase tudo abaixo é tranquilo; os riscos aparecem quando o
pacote for entregue a terceiros (cliente, outra empresa, venda).

## 1. O que vai no pacote

| Componente | Licença | Aviso no pacote | Uso interno | Se for distribuir |
|---|---|---|---|---|
| Código RPlayout | próprio | — | ok | ok |
| JS do servidor (75 pacotes) | MIT/ISC/BSD/Apache (inventário por pacote) | sim, `apps/server/dist/third-party` | ok | ok; falta só o aviso de `abstract-logging` |
| Interface (React, React DOM, scheduler, Zod) | MIT | sim, `apps/web/dist/third-party` | ok | ok |
| Node.js v24.16.0 | MIT + avisos de dependências | **não** | ok | incluir o LICENSE oficial (já coletado em 14/10, falta passar na build) |
| better-sqlite3 12.11.1 / SQLite | MIT / domínio público | não | ok | incluir aviso MIT |
| Crates Rust do engine (~75) | MIT/Apache-2.0 | **não** | ok | passar `-RustNoticesDirectory` na build (empacotador já aceita) |
| MediaMTX | MIT | sim, `mediamtx/LICENSE` | ok | ok |
| OMT (`libomt.dll`, `libvmx.dll`) | MIT | sim, `licenses/omt` | ok | ok |
| Runtime MSVC 14.51 (app-local) | redistribuível da Microsoft | — | ok | permitido pelos termos do Visual Studio |
| GStreamer (542 plugins em `runtime/gstreamer`) | LGPL-2.1 no núcleo; plugins variam | **não** | ok | ver item 2 |
| NDI runtime 6.3.2 (`Processing.NDI.Lib.x64.dll`) e `gstndi` | contrato proprietário NDI | **não** | ver item 3 | ver item 3 |

## 2. GStreamer — pontos de atenção

O runtime traz plugins de licenças diferentes:

- **x264 (`gstx264`, `x264-164.dll`) e x265 — GPL.** O engine usa `x264enc`
  quando não há `nvh264enc` (os dois aparecem no log da r88-22/r88-23). Uso
  interno: sem obrigação. Distribuição: GPL exige oferecer o código-fonte do
  conjunto e cria conflito com partes proprietárias. Alternativa para
  distribuir: só NVENC (`nvh264enc`) ou `openh264`, e remover x264/x265.
- **libav/FFmpeg (`gstlibav`, `avcodec-61` etc.)** — LGPL ou GPL conforme a
  compilação; confirmar como foi compilado antes de distribuir.
- **OpenH264** — licença BSD da Cisco; a cobertura de patente vale para o
  binário baixado da própria Cisco.
- **LAME, voaacenc, rtmp** — LGPL/Apache; incluir avisos.
- Nenhum texto de licença do GStreamer está no pacote. Para distribuir:
  incluir os avisos e oferecer o código das partes LGPL/GPL.

## 3. NDI

- DLL 6.3.2.0 (SHA256 `2b660207…dd84`), a mesma desde a r30.
- Os termos oficiais (NDI SDK License Agreement e NDI License Agreement) foram
  localizados em 19/10, mas não está comprovado qual contrato acompanha essa
  DLL. O download do SDK passa por um formulário (não enviado).
- A interface já mostra a atribuição/link NDI exigida.
- **Decisão que cabe ao usuário:** baixar o SDK 6.3.2 oficial (formulário da
  NDI), ler o contrato que vem nele e decidir. Para distribuir a terceiros, o
  contrato de distribuição do SDK precisa ser cumprido (EULA própria,
  atribuição, sem modificar a DLL).

## 4. Para fechar U5

1. Uso interno (hoje): só o item 3 depende de você — aceitar ou não o contrato
   NDI do SDK correspondente.
2. Se um dia distribuir: incluir avisos de Node, Rust, SQLite, GStreamer;
   resolver x264/x265 (GPL); confirmar a compilação do libav; revisar NDI para
   distribuição. Os itens técnicos de aviso eu consigo fazer na build quando
   pedido.

## 5. Atualização 27/10 (r88-25)

- Por instrução do usuário, os termos do NDI SDK foram aceitos (Remate Web) e
  os dois contratos oficiais (PDF, baixados de downloads.ndi.tv em 27/10,
  SHA256 conferido) vão no pacote em `licenses/ndi/`, com o aviso de marca e
  copyright. O runtime NDI 6.3.2 já vai dentro da instalação: o usuário não
  baixa nada à parte. O instalador do SDK em si (formulário com dados
  pessoais) não foi baixado: não é necessário para rodar nem para distribuir
  o runtime.
- `licenses/RPLAYOUT-EULA.txt` traz os termos exigidos pelo item 3d do
  contrato NDI.
- Textos incluídos mesmo sem distribuição: Node.js v24.16.0, 82 bibliotecas
  Rust (inventário + textos de cada pacote), SQLite/better-sqlite3,
  GStreamer 1.28.7 (lista de DLLs/plugins e textos LGPL/GPL/Apache/BSD/MPL),
  runtime MSVC. Fonte no repositório: `third-party-licenses/`; o empacotador
  copia para `licenses/` (`-ExtraLicensesDirectory`).
