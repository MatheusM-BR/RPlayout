# OMT — logging sem administrador

13/10/2026: teste nativo com runtimes do r54 passou por descoberta,
publicação, recepção, CUE, TAKE e retorno de sinal em 13,47s, sem exceção
de logging na saída observada. Não houve alteração de ACL/configuração.
A execução fora do isolamento de rede não prova operação por conta Windows
sem privilégios; essa homologação permanece aberta. Histórico original abaixo.

Diagnóstico local mostrou UnauthorizedAccessException criando log em
C:/ProgramData/OMT/logs. Não modificar ACL global nem executar como admin.

`omt_runtime::load_runtime` agora resolve a função oficial
omt_setloggingfilename e chama com null antes de iniciar descoberta/envio/
recepção. Política vale para engine e helper de dispositivos, que compartilham
o loader. Logs de ciclo de vida/falhas do RPlayout permanecem existentes.
Runtime sem essa função é recusado explicitamente como incompatível.

Não alterar OMT_STORAGE_PATH: segundo o header oficial essa variável também
redireciona settings.xml e pode trocar o DiscoveryServer da instalação.
Nenhuma DLL foi substituída, nenhuma configuração externa/ACL foi alterada.

Referência primária consultada em 12/10:
https://github.com/openmediatransport/libomt/blob/master/libomt.h
seção Logging, omt_setloggingfilename(const char* filename), null desativa;
seção Settings descreve OMT_STORAGE_PATH e DiscoveryServer.

Implementação ainda não compilada/executada neste lote. Verificar no fechamento
que a chamada inicial realmente evita a exceção, inclusive antes de eventual
inicialização estática da biblioteca. A função documentada não é, sozinha,
prova de comportamento do runtime embutido. Não declarar erro resolvido até
esse ensaio. Depois executar recepção/publicação/reconexão com sinais reais.
