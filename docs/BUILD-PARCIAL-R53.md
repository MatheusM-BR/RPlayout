# RPlayout r53 — instalador de teste

## Evidência posterior à geração

ZIP537781278bytes/SHA256
2C0C7C73F02E8BFAD256D50B3C5F3ED43FF4EB12A8112EEC0A5909585F05296C.
Empacotador exit0. Executado INSTALAR.ps1 extraído do próprio ZIP em
scratch/r53-installed-qa-20261012, atalhos em scratch/r53-shortcuts-qa-20261012.
Instalador completou catálogo/extração/hashes e imprimiu sucesso. O wrapper
de QA reportou erro por consultar LASTEXITCODE após um script PowerShell
(valor não definido/stale; não um código nativo do instalador). Não considerar
o wrapper exit1 um PASS; conferência independente posterior confirmou recibo
edition r53/integrity VERIFIED/serverStarted=false, perfil com cofre dentro
da instalação e sete links existentes apontando ao destino correto.
Nada criado no menu Iniciar e nenhum programa aberto. Windows limpo, abertura
pelos links e funcionamento com o perfil instalado continuam NÃO VALIDADOS.

Mantém servidor/engine/QC da r52 e integra instalador com cofre exclusivo
por instalação em data/security/vault.json. Identificação de edição obrigatória:
ausência não presume versão antiga. Pasta existente nunca é sobrescrita.
Parâmetros de QA permitem payload externo e atalhos em pasta separada;
instalação normal continua criando atalhos no menu Iniciar.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Preserve banco,
mídia e cofre. Para restaurar banco protegido de outra edição, preserve sua
chave original e use o fluxo explícito de restauração; cofre novo não a substitui.
Não é Setup.exe assinado. Inclui Node/SQLite e runtimes, sem tsx/tsc/pnpm
na execução. WindowsPowerShell nativo continua necessário ao DPAPI; DeckLink
exige driver oficial. Licenças/redistribuição ainda precisam de revisão.

Não homologado para ir ao ar: Windows limpo, execução pelos atalhos,
sinais externos, carga prolongada e operação completa continuam abertos.
Grupo8 reservado àv3.10grupos/53verificações:6concluídas,32andamento,
8pendentes,7adiadasv3. Registro posterior de geração/teste será externo.
