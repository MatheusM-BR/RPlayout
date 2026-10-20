# RPlayout r69 — parcial instalável para teste interno

Destino: release/RPlayout-1.1-parcial-20261015-r69-instalador.zip.
Gerado: 540186632 bytes. SHA256
5E51B978F35F3AF1229753BC9C08509AE46337509C218C4B0E03483D2FCE6C3C.
Integridade PASS: 7094 arquivos do manifesto / 7095 entradas, leitura em
memória sem extração ou execução. Evidência externa:
scratch/r69-zip-integrity-20261015/result.json. Este registro posterior não
faz parte do README já incorporado ao ZIP, que preserva o estado pré-geração.
Integra r68 e correção da carga inicial do acervo: operação não espera pastas/
categorias, leituras GET limitadas e compartilhadas por contexto, respostas
antigas descartadas, aviso recuperável e catálogo não conferido distinto de
catálogo vazio no Master/Playlist/QC. Não cancela gravações.

33 testes / 6 arquivos e tipos web PASS; builds web/servidor/engine release
locked PASS. Regressão visual de fonte em fixture isolada com falhas HTTP:
Master/Playlist/QC abrem; timeout aproximadamente 10s, sem sobreposição;
recuperação sem recarregar operação; zero mutações/as-run/POSTs. Não transferir
essa prova para instalação r69, Windows limpo ou sinais físicos.
Docs: ACERVO-INICIAL-INTEGRACOES-2026-10-15.md.

Web index-B4CsWAEs.js, SHA256
3F13498EA4D12EA450886C8A4B37EC56754FEBF8A665219727155E4BD7DC4FD8.
Servidor 5F33C58E58E2D26294FAD3EFF71F994C82D093AE0F6159DAC91BDE8508A64607.
Engine 3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
Node/SQLite/engine/runtimes incluídos; startup do produto não usa tsx/tsc/pnpm
globais. QA usa ferramentas locais próprias e não comprova Windows limpo.

O README incorporado antecede a conferência externa de integridade acima.
Instalação/startup r69 NOT_RUN. Não alterar essa informação com provas da r68.
Não sobrescreve build anterior, instalação operacional, mídia ou bancos.

Acesso: localhost:porta no servidor; IP/nome:porta em outra estação.
Nenhum IP remoto é fixado no cliente; não foi testada conexão ao servidor
192.168.42.172. Proxy/HTTPS e estação remota permanecem pendentes.

Homologação final ainda exige grupos restantes, sinais externos/placa (adiada),
carga/soak, recuperação, instalação limpa, licenças e publicação. Grupo 8 v3.
Redistribuição REVIEW_REQUIRED: NDI SDK original indisponível, MSVC/codecs/
abstract-logging ainda em conferência; notices não significam liberação jurídica.
Total: 10 grupos/53 verificações; 6 concluídas/36 em andamento/4 pendentes/7 v3.
