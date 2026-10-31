# RPlayout r67 — parcial instalável para teste, não homologada

Novo ZIP:release/RPlayout-1.1-parcial-20261014-r67-instalador.zip.
Gerado540183170bytes, SHA256
292FE58A8CDEA1B1BC56B09664F92D1381BBE046A8BA0B9906AD16A42BAF4594.
Integridade pós-geração PASS:7094 arquivos/7095 entradas; leitura em memória,
sem extração integral. Evidência:scratch/r67-zip-integrity-20261014/result.json.
Este registro externo é posterior ao README incorporado no ZIP.
Integra a r66 e o lote HTTP de privacidade, origens e endereços autorizados.

- Logs de requisições/erros não expõem query, cabeçalhos, corpo ou stack bruto.
  Erros500 têm diagnóstico seguro; controles são privados/no-store e mídia
  preserva Range/bytes e cache privado.
- Lista explícita de origens validada antes do banco/runtime; origens extras
  continuam exigindo autenticação. Configuração inválida não inicia o servidor.
- Endereços reais do servidor/localhost na porta de escuta continuam aceitos;
  nomes personalizados exigem RPLAYOUT_ALLOWED_HOSTS. Endereço forjado não é
  autorizado apenas porque o Origin combina. Host duplicado também é recusado.
- Na estação remota, abrir IP/nome e porta do servidor; localhost é somente
  a máquina de quem acessa. Não há IP192.168.42.172 fixado nem liberação de rede.

Fonte: testes dirigidos de cada lote, tipos servidor e builds web/servidor/
engine release locked PASS. Host:57 casos (25Host/25Origin/7privacidade) e
compilado bnigjr com6 partidas inválidas,18HTTP e3WS PASS. Provas anteriores
de privacidade YmdGq8 e origens ac50DO pertencem aos hashes anteriores;
não são regressão global do servidor atual.

Servidor CC32625E31E77C78A59D943BE8BF9D7AACC041C586BED798CE821B43CEAF35E3.
Engine3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
Web recém-construída index-B0b5xQEY.js (carimbo de build atualizado).
SHA256 DECB800640913A0BB2A12C215E68C54377443FE2B8EB64FBADA4AF53625BF97F.
Node/módulo SQLite/runtime nativo incluídos; não requer tsx/tsc/pnpm globais
para iniciar. Requisitos de driver físico não podem ser substituídos por pacote.

Entregue sem outra extração/instalação QA. Instalação e startup instalado r67
NOT_RUN, sem herdar homologação de r65/r66. Integridade ZIP registrada
externamente após geração; o README interno não contém hash do próprio ZIP.
Sem mudança no servidor operacional, sem limpeza e sem teste no IP remoto.

Para fechar6.4 faltam integração completa de auditoria/credenciais, política
proxy/HTTPS e acesso remoto real. Windows limpo, fontes externas, carga/soak,
cenários restantes de recuperação e publicação final no GitHub continuam
abertos. DeckLink física adiada; grupo8 reservado para v3.
Redistribuição REVIEW_REQUIRED (NDI/MSVC/codecs/abstract-logging); notices não
equivalem à liberação jurídica ou autorização de publicação final.

Total10 grupos/53 verificações:6 concluídas,36 em andamento,4 pendentes,7v3.
Documentos:ENDERECOS-ACESSO-2026-10-14.md,ORIGENS-ACESSO-2026-10-14.md,
PRIVACIDADE-HTTP-LOGS-2026-10-14.md; matriz PENDENCIAS-NUMERADAS.md.
