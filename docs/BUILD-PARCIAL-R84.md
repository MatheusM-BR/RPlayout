# RPlayout r84 — parcial instalável interna

## Resultado posterior à geração (ZIP original preservado)

Instalador real no D: PASS (7.100 arquivos, recibo VERIFIED, sete destinos de
atalhos). ZIP540524059bytes/SHA256
D50FDE2C2AE71E24B0B3B4F2712DAEDB9F2C4CE8058E403C747305B2D7C62F50.
O novo fluxo de retorno foi recusado antes de preparar/ativar em
`D:\RPlayout-builds\qa\compatible-rollback-BiYlyT`: leitura PS5 do manifesto
sem UTF-8 interpretava incorretamente um caminho com snow☃. Arquivos reais
conferidos íntegros; correção integrada na r85. Não recomendar a r84 para esse
assistente. Relatório FAIL preservado, sem alteração do instalador já gerado.

## Registro pré-geração

Destino: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r84-instalador.zip`.
Registro pré-geração; hash/instalação/ensaio posteriores serão registrados sem
alterar o ZIP. Projeto, dados e pacotes anteriores preservados.

Novo fluxo prepare-rplayout-rollback.ps1 / start-rplayout-rollback.ps1:

- Usa o snapshot completo mais recente, não substitui pelo backup pré-upgrade.
- Compara o histórico com o baseline, recusa IDs ausentes e identidades históricas
  alteradas; não mescla registros nem inventa duração/frame de saída.
- Exige contrato exato do schema da edição escolhida, ferramentas declaradas e
  manifesto/bytes regulares materializados. Novo rollback-contract.cjs permite
  às próximas edições declarar o contrato; r83 anterior é aceita somente pelo
  manifesto completo exato já qualificado. Versão desconhecida é recusada.
- A própria edição de destino restaura o snapshot em pasta nova/quarentena.
  Recibo privado vincula backups, perfil, manifesto, contrato e histórico.
- Início confere novamente procedência/integridade e chama o assistente real
  de destino, que mantém revisão fresca, confirmação explícita, posse e admissão
  nativa. Não para o predecessor, não troca perfil nem faz TAKE na preparação.
- Downgrade de schema incompatível permanece bloqueado, sem remover marcadores.

26 casos distintos afetados de domínio/integridade PASS; tipos/build PASS.
Teste de hardlink inicialmente bloqueado pelo sandbox, executado separadamente
com permissão sem afrouxar a proteção real. Quatro casos PS5 das duas novas
entradas passaram com caminhos de módulos conflitantes. Não equivalem a retorno
operacional completo. Instalação/retorno desta edição NOT_RUN neste README.

Engine610E03E8/launcher101A28C9/web8B0D3FCB inalterados da r83. Somente novos
bundles e scripts; sem novo build Rust nem teste de mídia apenas por status.
Não certifica hardware, Windows limpo, schema incompatível, energia, outra conta,
sinais externos ou estabilidade prolongada. Redistribuição REVIEW_REQUIRED,
acordo original NDI indisponível; DeckLink física adiada; grupo8v3.

Totais seguem10grupos/53verificações; consulte PENDENCIAS-NUMERADAS.md após
qualificação. Parcial interna, não entrega final homologada.
