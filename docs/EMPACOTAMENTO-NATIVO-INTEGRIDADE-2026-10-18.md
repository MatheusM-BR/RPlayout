# 10.2 /10.4 — seleção nativa e integridade dos bytes no ZIP

## Implementações do lote

O empacotador já aceitava engine externo, mas selecionava o host guard sempre
da árvore de build C:. Após atualizar o fonte do diagnóstico de portas, isso
poderia selecionar um helper antigo mesmo com engine novo vindo do cache D:.

Acrescentado `-HostGuardBinary`, junto de `-EngineBinary`, usando seleção
somente-leitura comum em `scripts/lib/build-source-roots.ps1`:

- Override exige caminho absoluto e `-UseCurrentBuilds`; ausência/invalidez
  gera recusa, sem fallback silencioso para outro binário.
- Arquivo e ancestrais devem ser materializados, sem reparse/junction/symlink.
- Conferência estrutural de cabeçalhos DOS/PE/AMD64/PE32+, seções e extensão
  dos cabeçalhos; DLL/x86/truncamento recusados. Não prova compilação, assinatura,
  ABI, origem legítima ou capacidade de publicar.
- SHA256 calculado no mesmo handle de leitura do cabeçalho, que exclui escrita/
  remoção concorrente enquanto aberto. Hash selecionado fixa a expectativa do
  manifesto. Os três destinos do engine recebem a mesma fonte; alias de host
  guard na raiz, caso exista na base, também recebe a fonte selecionada.
- Fontes convencionais continuam possíveis após build normal. Isso não as
  certifica atuais: a futura r88 exige engine/helper explicitamente conferidos.

Foi corrigida também uma janela de integridade: antes o hash era conferido e,
só depois, abria-se outro handle para copiar. Um arquivo alterado nesse intervalo
poderia produzir ZIP divergente do manifesto, embora a instalação devesse recusá-lo.

`scripts/lib/verified-zip-file.ps1` agora é usado no loop real do empacotador:
abre fonte excluindo escrita/remoção, copia em blocos de1MiB, calcula SHA256 dos
MESMOS bytes copiados e compara tamanho/hash com o manifesto antes de prosseguir.
Falha propaga; o fluxo não alcança a publicação por Move-Item. `.building` não
é reparado/apagado automaticamente e destinos existentes continuam recusados.
Recursos são descartados inclusive se o fechamento da entrada ZIP falhar.

Não alterados destino de build autorizado D:, Node/SQLite, inventários de
licenças, política de não sobrescrever releases ou declaração de parcial sem
testes funcionais. Os helpers novos só existem no autor do pacote, não geram
dependência nova no computador instalado.

## Verificações realizadas / não realizadas

- Parser PowerShell dos três arquivos: PASS (sem executar seus corpos).
- Sintaxe Node dos dois roteiros de teste: PASS (sem executar testes).
- Leitura independente dos cabeçalhos reais do engine610E e host guard5B26 em
  C:, e engine0250 no cache D:: AMD64, PE32+,5seções, optional header240bytes,
  cabeçalhos dentro do arquivo, hashes anteriores preservados. Isso NÃO é
  execução da função PowerShell nem prova de build/partida.

NÃO executados os testes funcionais novos, sob a mesma recusa conhecida de
carregamento de scripts e criação de junction. Não se mudou política/Registro/
ACL, não se avaliou texto extraído de script nem se trocou de host para contornar.
Limite do serviço de autorizações ainda anterior à data de liberação registrada;
nenhuma nova tentativa de compilar/escrever em D: neste lote.

Casos preparados, **NOT_RUN**:

1. Seleção nativa padrão e override Unicode com hash exato; nenhum fallback.
2. Recusas: caminho relativo, ausência de UseCurrentBuilds/arquivo, cabeçalhos
   inválidos, x86, DLL, truncamento e junction real.
3. Cópia ZIP com mais de1MiB+cauda, bytes binários e nome Unicode; extrair e
   confrontar os bytes efetivos, não só contadores.
4. Arquivo vazio realmente verificado; hash/tamanho divergentes recusados.
5. Handle de escrita QA já aberto impede confiar na origem, sem matar processo.

As fixtures PE são inertes e nunca executadas; os ZIPs de teste são próprios,
não o instalador do produto. Preflight prepara resultado BLOCKED/zero testes
funcionais se o Windows recusar carregamento, sem tratar recusa como teste de
regra de negócio aprovado. A rodada não foi repetida só para registrar status.

## Próximos gates

Executar seletores/cópia e ensaio completo do empacotador no ambiente autorizado;
compilar/testar engine/host guard e informar arquivos absolutos observados;
usar servidor5B92432F/interfaceEFDC03FF isolados atuais; gerar r88 NOVA em
`D:\RPlayout-builds`, conferir ZIP/manifesto, instalar em QA e validar o fluxo
integrado restante. Header/hash não substituem nenhuma dessas etapas.

Não gerado instalador; não criado ZIP de teste neste lote. Nenhum binário,
build isolado, instalação, release, banco operacional ou arquivo D: alterado.
R87 continua a última instalação verificada. Grupo8v3/DeckLink adiada mantidos.

10.1 segue concluída somente para r87 histórica. 10.2/10.4 continuam em andamento.
Total:10grupos/53verificações —8concluídas,34em andamento,4pendentes,7v3.
