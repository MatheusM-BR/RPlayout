# Retorno compatível — r86 — 16/10/2026

## Artefato e instalação

Parcial interna: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r86-instalador.zip`.
540525930bytes; SHA256
`21FFBA9B3929C039D94945E978F4ED716BD19BE3F987D69BEB11DE04EF91150C`.
Servidor `7D2568300761AE477A60A4C3C9B8EA26821D4680B3C840052117F5A98ED0348B`.
Engine610E03E8, launcher101A28C9 e interface8B0D3FCB não foram alterados neste lote.

Instalador incorporado executado em `D:\RPlayout-builds\qa\r86-installed-20261016`.
Recibo VERIFIED, 7.100 arquivos materializados/conferidos, perfil isolado e sete
destinos de atalhos PASS. Evidência: `qa\r86-install-evidence-20261016\result.json`.
Não foram iniciados serviços por instalar; isso não homologa Windows limpo.

## Implementação

- Contrato de schema explícito por edição; edição histórica r83 só admitida pelo
  hash exato de seu manifesto completo. Edição desconhecida/incompatível recusa.
- Comparação de histórico exige todos os IDs anteriores e identidades imutáveis.
  Preserva TODO o snapshot mais recente, inclusive novos registros e fechamento
  posterior de ocorrências. Não mescla bancos nem volta ao backup anterior.
- Restauração feita pelo executável real da edição de destino em nova quarentena.
  Perfil candidato, snapshot, inventário e recibo protegidos pelo cofre original.
  Preparação não inicia/paralisa canal nem muda perfil; revisão não é autorização
  reutilizável de TAKE. Ativação/admissão/adoção continuam na edição de destino.
- Novos backups são finalizados autocontidos SOMENTE no arquivo novo criado pela
  operação. Não altera modo de journal da origem nem apaga WAL/SHM originais.
  `-ExportSnapshots` solicita novas exportações consistentes para arquivos
  históricos; modo padrão continua recusando entradas com auxiliares.
- As duas novas entradas PowerShell leem manifesto UTF-8 e usam módulos do
  próprio PowerShell, sem resolver módulos estrangeiros de outro ambiente.

31 casos distintos PASS: contrato6, histórico3, comparação6, integridade11,
backup3 e exportação2. A fixture de hardlink inicialmente recusada pelo sandbox
foi a única repetida com permissão para criar o link. Quatro casos de bootstrap
e dois de manifesto Unicode PASS, sem executar ferramentas reais nas fixtures.
Tipos/compilação do servidor PASS; sem recompilar Rust inalterado por status.

## Falhas anteriores preservadas

R84 instalada PASS, novo fluxo FAIL BiYlyT por caminho Unicode no manifesto
interpretado incorretamente no PS5; nenhum retorno ativado. R85 instalada PASS,
fluxo FAIL VNw64T ao recusar arquivos com WAL/SHM, também antes de ativar.
Não houve corrupção constatada nos pacotes nem remoção dos auxiliares para
forçar aceitação. ZIPs/relatórios FAIL continuam preservados.

## Ensaio integrado

`qa\compatible-rollback-6NN6PM` FAIL: preparação/exportação confirmou snapshot
em quarentena, um registro novo e um alterado, sem perder IDs anteriores. O
destino r83 recusou checkpoint na inicialização; ativação assinada
36af7d0d-4a50-4235-ba46-51628f9b9da8 FAILED, sem liberar saídas nem retomar PGM.
`assertions-compatible-rollback-refusal.json` PASS/sourceRunResultFAIL confirmou
recibo, origem retida, histórico/cursor idênticos ao snapshot, zero liberações
de saída desta tentativa, perfis/originais preservados e família própria parada.
Isso qualifica recusa segura, NÃO retorno bem-sucedido. Nenhuma captura foi
feita nem a mesma ativação repetida. A r87 corrige a retenção da prova local de
parada durante uma posse; não modifica a r83 nem prova retroativamente a causa
transitória desta falha. PIDs históricos estavam ausentes na consulta posterior.

Origem dos dados: snapshot nativo r83 de M6lwbz, comparado com o backup anterior
IQkjFO. O novo controlador r86 retorna para o pacote r83 intacto; não é prova de
PGM executado na r86 e depois revertido nem downgrade de schema. A edição r83
é identificada pelo manifesto6897C8E308CF40893804B9313A10255F75271C5028EAD63FF6C6E1D66D2E981C.
Nenhum sinal externo ou placa física participa deste ensaio.

## Limites e próximas verificações

9.3/10.4 seguem em andamento: PGM/mídia/jobs históricos migrados, interrupção de
migração, adoção interrompida depois de publicar candidato, perda de energia,
retorno a schema incompatível (recusa segura, sem transformação inversa),
operação real de edição nova seguida de retorno e homologação prolongada.
Windows limpo, fontes externas e redistribuição/licenças continuam separados.
NDI SDK original ausente, publicação pública não liberada. DeckLink adiada;
grupo8 reservado à v3. Nenhuma pasta do projeto foi movida ou apagada.

Totais preservados:10grupos/53verificações,8concluídas/34andamento/4pendentes/7v3.
Esta versão:9grupos/46verificações; não há nova conclusão ampla só por este lote.
