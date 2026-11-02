# RPlayout r25 — build parcial, sem validação funcional

Gerada em 08/10/2026 a pedido do operador, sem executar testes funcionais,
testes automatizados ou instalação de homologação. Não é a entrega final.
A compilação e o empacotamento não comprovam o funcionamento operacional.

Artefato: `release/RPlayout-1.1-parcial-20261008-r25-instalador.zip`.
Tamanho:535725223 bytes. SHA-256:
`E5106B7790D606DDE6291C5B72E3CBFA85F2D5993E8CBD23F971F496DCED0DC3`.
Servidor incluído SHA-256:
`723D9616C0F927F6ADE334ADBFB9B8CC9217C1AA5371328C1B45A29EA61C8A7F`.
Este registro de hashes foi acrescentado após a geração do ZIP; o LEIA-ME
interno contém as instruções e limitações, não este registro posterior.

Inclui o fluxo integrado de ingestão/proxy/QC/publicação/TAKE, a proteção
de aprovação pelo perfil de QC, safe area ajustada à imagem e desativada
por padrão, e as últimas proteções da análise de mix de áudio. As alterações
posteriores à r24 estão incluídas, mas não homologadas neste pacote.

Extraia TODO o ZIP e execute INSTALAR.cmd. Use uma pasta nova. A instalação
é por usuário, cria atalhos no menu Iniciar e não inicia o servidor automaticamente.
Abra RPlayout Server e depois Master ou QC. O controle remoto é pelo navegador
no endereço do servidor, sujeito à configuração de rede e firewall.

Inclui Node, servidor compilado, módulos de produção/SQLite, interface,
engine, auxiliares, GStreamer e runtimes NDI/OMT/MSVC. Não requer tsx,
tsc ou pnpm na máquina de operação. DeckLink ainda requer o driver físico
Blackmagic Desktop Video. Não é um Setup.exe assinado.

Não sobrescreve instalação anterior. Use ambiente de teste separado e faça
backup antes de qualquer migração de dados de produção. O instalador confere
os hashes do manifesto quando executado; isso não substitui homologação.

Total: 10 grupos de pendências, 1 concluído e 9 abertos. 53 verificações de
fechamento: 5 concluídas, 18 em andamento e 30 pendentes. Inventário detalhado
em docs/PENDENCIAS-NUMERADAS.md. A build parcial não altera esses totais.
