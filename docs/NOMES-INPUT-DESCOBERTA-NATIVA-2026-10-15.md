# 3.2 — Nome da input após seleção: conclusão funcional

15/10/2026. Estado: **concluída no escopo do cadastro/nome**, não homologação
de vídeo/áudio externo. Grupo 3 permanece aberto: 2/7 concluídas, 5/7 em andamento.
Matriz global: 10 grupos/53 verificações, 7 concluídas, 35 em andamento,
4 pendentes e 7 adiadas à v3. Grupo 8 continua fora desta versão.

## Contrato conferido

Selecionar a entrada primeiro; mostrar o nome abaixo do seletor; preencher com
o rótulo efetivamente descoberto; acompanhar mudanças de seleção enquanto não
houver apelido manual; preservar o apelido; permitir voltar ao nome da fonte.
Não converter arbitrariamente caixa ou acentos de nomes/referências no produto.
Cadastro não sintoniza CUE, não troca PGM e não qualifica sinal.

## Ensaio realizado

`scripts/verify-input-name-native-browser.mts` iniciou quatro emissores reais
do engine instalado: dois NDI e dois OMT, com imagem/áudio sintéticos de espera.
Nomes exclusivos incluíam `Çãó` e o identificador do controlador 12944.
Não houve resposta `/api/sources` simulada. A descoberta foi feita pelo auxiliar
nativo, pelo plugin NDI e pelo runtime oficial OMT incluídos no ambiente QA.

Em `scratch/input-names-native-vT4ELw`, serviço, banco, cofre, acervo vazio e
registros GStreamer eram próprios do teste. Servidor/engine de reprodução do
canal QA desabilitado; emissores separados não eram o PGM operacional.
Navegador local IAB, aba própria 14, conta temporária `names-verifier`.
Nenhuma conta, banco, saída ou aba operacional foi usada.

No cadastro de Entradas & Ao Vivo:

- NDI A preenchido automaticamente; mudar para B atualizou o nome.
- Apelido `Estúdio QA ÇÃÓ NDI` preservado ao selecionar A.
- Botão de usar o nome da fonte restaurou A; atualização da descoberta o manteve.
- NDI salvo inicialmente com nome/referência A exatos.
- OMT A/B preencheram nomes exatos retornados pelo runtime; apelido manual
  permaneceu ao mudar fonte; restauração automática e gravação de B conferidas.
- Campos de nome abaixo dos seletores confirmados por geometria do DOM.
- Recarregar a página e reabrir a lista confirmou ambos os cadastros.
- Editar NDI, salvar o apelido e reabrir preservou o apelido; mudança de fonte B
  somente no rascunho não o apagou. Cancelar não alterou a conexão A gravada.

No cadastro + Ao Vivo do Master:

- Selecionar NDI B preencheu o nome de B, não o apelido do cadastro A.
- Apelido manual preservado ao mudar protocolo para OMT.
- Limpar o apelido e selecionar OMT A restaurou seu nome de descoberta.
- Salvar na Biblioteca MAM criou OMT A com esse nome/referência exatos.

O campo não recebeu alteração nesta rodada: o fluxo existente foi qualificado
contra fontes nativas efetivamente anunciadas. O web usado corresponde à r70
(`index-DRFaiZfx.js`), mas servido como overlay explícito sobre o servidor r68;
isso **não equivale a instalar/testar o pacote r70 inteiro**.

## Resultado e limites

`scripts/verify-input-name-evidence.mjs scratch/input-names-native-vT4ELw`
retornou **PASS**: 18 observações de navegador confrontadas com descoberta e
estado final, três fontes persistidas, quatro decisões LIVE_SOURCE_EDITED
(três inclusões + uma edição), quatro API_MUTATION, uma sessão criada.
Zero itens na grade e zero as-run. Verificador lê evidência já produzida; não
reexecuta o navegador nem escreve no banco do produto.

Quatro emissores encerraram com exit 0, sem encerramento forçado; servidor QA
encerrado e aba própria fechada. `FIXTURE_FINISHED` no controlador não é por si
um PASS de interface: a conclusão depende da observação e asserção separadas.

Provas preservadas:

- `scratch/input-names-native-vT4ELw/result.json`
- `scratch/input-names-native-vT4ELw/browser-observations.json`
- `scratch/input-names-native-vT4ELw/assertions-names.json`
- `scratch/input-names-native-vT4ELw/entradas-gravadas.png`
- `scratch/input-names-native-vT4ELw/master-nome-omt.png`

Proveniência: servidor `5F33C58E58E2D26294FAD3EFF71F994C82D093AE0F6159DAC91BDE8508A64607`,
engine `3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65`,
web `B10A5AF6C69EADAF5A990BD0919C7AE712AC5E76DE4232B9FAA2A62BA5AFB3F2`.
Auxiliar devices compilado da fonte com diagnóstico opcional `--trace`:
`D7396F7C17C95440446F7BD9590D6581706EA00F4C0FA6CED329B9C4A1438B5D`.
Hashes das evidências constam na asserção. Override de web/devices declarado.

Não foram certificados reprodução NDI/OMT no QC, CUE/TAKE desses emissores,
recepção externa dos publishers, DeckLink, estação remota ou Windows limpo.
Os marcos 2.x/3.3/10.x correspondentes permanecem abertos. O nome/endereço SDI
físico continuará dependente do inventário real da placa; teste adiado pelo
operador. Descoberta/nome não equivalem a presença ou qualidade de sinal.

## Falhas anteriores preservadas e correção do ensaio

`input-names-native-TbFqmc`: quatro emissores prontos, descoberta ultrapassou
20 segundos; FAIL preservado. A causa desse timeout não foi determinada.
Não chamar isso de teste aprovado ou atribuir automaticamente a cache frio.

Para diagnosticar, `apps/engine/src/bin/devices.rs` ganhou `--trace`: tempos e
etapas fixas no stderr, sem nomes/endpoints/erros privados; stdout continua JSON.
Build release do auxiliar PASS; cinco testes unitários PASS. Esse auxiliar é
override do ensaio e ainda não integra o ZIP r70 preservado.

`input-names-native-msCu3N`: descoberta retornou as quatro fontes corretamente,
mas a asserção exigia a caixa do nome anunciado. O libomt devolveu endereços
em minúsculas; o código Rust apenas copiou as strings nativas, sem lowercasing.
O trace mostrou consultas completas (~10,7s na primeira, ~5,1s nas seguintes),
não um bloqueio permanente de uma família. Não foi implementado isolamento
de famílias com base nesse sintoma sem evidência.

O controlador passou a comparar somente a identidade dos seus anúncios OMT
sem distinguir caixa. NDI continua comparação sensível à caixa. Expectativas
de interface/banco continuam os rótulos e referências nativos **exatos**,
inclusive caixa e acentos; nenhuma conversão foi introduzida no produto.

Houve tentativas de seletor antes da conclusão da leitura e um botão de login
com caixa divergente; a observação do DOM permitiu selecionar os controles
corretos. Não houve reenvio de gravação, quatro mutações finais conferidas.

## Continuidade

Próximo marco do grupo: 3.3, QC direto para os demais protocolos, separando
ensaio sintético local de homologação externa. 3.4–3.7 permanecem com seus
limites descritos na matriz. Não repetir os testes editoriais/r70 por alteração
de status; nenhum novo pacote foi gerado por esta conclusão funcional.

Preferência de acesso confirmada pelo operador: localhost quando local; nome
ou IP com porta quando necessário, inclusive `192.168.42.172`. IP não fixado,
nenhuma configuração/rede operacional alterada e nenhum teste remoto alegado.
