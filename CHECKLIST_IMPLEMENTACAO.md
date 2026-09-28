# Checklist e histórico da implementação

Este arquivo é o registro versionado do andamento do ERP Comex. Atualize-o em
todo incremento: marque o status, registre a evidência verificável e acrescente
uma linha no histórico. Não remova registros anteriores.

## Convenções

- `[ ] Não iniciado` — ainda sem implementação ou evidência.
- `[-] Em andamento` — implementação parcial; o aceite ainda não foi atendido.
- `[x] Concluído em teste` — implementado e validado no ambiente local de teste.
- `[!] Bloqueado/decisão` — depende de confirmação de negócio, acesso externo ou aprovação.

Uma marcação `[x]` só pode ser usada quando houver teste ou evidência descrita
na coluna **Evidência**. Produção só é marcada depois de homologação formal.

Os quadros e resultados SQLite/.NET anteriores à seção **Atualização do
incremento atual** registram a implementação histórica, que foi removida do
snapshot. Eles não comprovam implementação nem aceite na API Node. Para o
estado executável após a limpeza, use a tabela do incremento atual.

## Ponto de retomada obrigatório

**Última atualização:** 2026-09-28

**Estado seguro atual:** Planilha, ZIP e banco SQLite locais foram preservados,
mas continuam ignorados pelo Git. Os arquivos .NET/SQLite e Compose foram
retirados do snapshot ativo; as linhas históricas abaixo registram validações
anteriores e não significam que esses recursos existam na API Node. A API
Fastify tem runner explícito de migrations PostgreSQL e implementação parcial
de OIDC/PKCE, callback, sessão PostgreSQL, CSRF e logout. O HEAD local contém
dois commits à frente de `origin/main`; o push aguarda a autenticação do Git
Credential Manager no navegador. A URL de desenvolvimento encaminha para
`localhost:4000`; `VPS_API_URL` ainda não foi configurada na Vercel.
**Próximo incremento obrigatório:** validar DEV13 em PostgreSQL isolado e E2E autenticado. A API Node já fornece carteira, overview de leitura e histórico sob escopo; qualidade e escrita operacional seguem pendentes. DEV04 passou em testes locais; DEV03 e DEV05 permanecem parciais. M001–M007, checksum e concorrência/upgrade temporário foram validados apenas em `erp_po_totvs_test` (7 aplicadas/0 pendentes). Sem commit/push até nova orientação. A Vercel Free hospeda Next.js; `proxy.ts` encaminha `/auth/*` e `/api/v1/*` por HTTPS com token server-only.
A API conecta a PostgreSQL local/privado; nenhuma conexão ou porta
5432 é exposta à Vercel ou ao browser. API, banco e reverse proxy/túnel iniciam
automaticamente na VPS; o computador pessoal pode ficar desligado. OIDC/segredos
ainda não foram configurados ou validados. O MCP Vercel consta em
`~/.codex/config.toml`, mas não está carregado como ferramenta neste processo;
nenhum projeto/setting Vercel foi inspecionado. Esta escolha e documentação
foram registradas em 2026-09-24; endpoints de negócio, issuer de teste,
instalação persistente na VPS e E2E continuam pendentes. A referência aceita
para a cópia de trabalho é 7.000 linhas no Pré e 195 no Pós.

**Estado da validação em 2026-09-25:** `corepack pnpm install --frozen-lockfile`
e `corepack pnpm build` passaram na API após o incremento OIDC. Docker não faz
parte da stack definida da API; o PostgreSQL da VPS é publicado pelo serviço
Docker `postgres_postgres`. Na VPS, o pacote foi
transferido para `/tmp/api-migration-validation`; o banco isolado
`erp_po_totvs_test`, de propriedade da role `erp_po_totvs_migrator`, foi usado
para validar o runner. `migrate:status` mostrou 0 aplicadas/7 pendentes;
`migrate:up` aplicou M001–M007; o status seguinte mostrou 7 aplicadas/0
pendentes; e a reaplicação concluiu com 0 migrations aplicadas. O Node
24.21.0 foi instalado em `/opt/node-v24` sem substituir o Node 20 do sistema;
o checksum oficial do pacote foi validado. A firewall Hostinger bloqueia
5432/6543/6379 externamente e mantém 22/80/443 acessíveis. A conexão isolada
usou TLS com opção de compatibilidade por causa do certificado PostgreSQL
self-signed sem SAN; isso não valida TLS de produção. Naquele registro,
checksum alterado, concorrência e upgrade ainda estavam pendentes; os resultados
executados em 2026-09-28 estão registrados abaixo.

**Atualização da validação em 2026-09-28:** em cópia temporária no pacote da
VPS, `migrate:status` rejeitou a alteração de M007 com `Checksum divergente`; o
arquivo foi restaurado e status voltou a 7 aplicadas/0 pendentes. Para upgrade,
foi criada somente no pacote temporário M008, com uma tabela de prova em
`erp_po_totvs_test`. Duas execuções simultâneas de `migrate:up` terminaram sem
erro: uma aplicou M008 e a outra aplicou zero; status confirmou 8/0. A tabela e
a linha M008 do ledger foram removidas em transação; o arquivo M008 e os logs
temporários foram apagados. Status final confirmou M001–M007 aplicadas e zero
pendentes. A senha da role de teste foi redefinida interativamente; nenhum
segredo foi registrado. O arquivo de ambiente temporário, criado com modo 0600,
foi removido. A conexão usou `uselibpqcompat=true&sslmode=require`, sem validar
identidade do servidor nem TLS de produção. DEV05 continua parcial até a
validação de TLS de produção e integração de CI; issuer OIDC, bootstrap e E2E
também continuam pendentes.

### Arquitetura de publicação escolhida

- **Hospedagem:** Vercel; monorepo com Root Directory `apps/web`.
- **Aplicação:** Next.js App Router + React + TypeScript na Vercel Free; Fastify/
  Node.js na VPS; `proxy.ts` encaminha chamadas same-origin com token secreto.
- **Dados:** PostgreSQL na VPS, acessível localmente apenas pela API Node usando
  `DATABASE_URL` armazenada na VPS e role de privilégio mínimo. Sem conexão Vercel
  → PostgreSQL e sem porta 5432 pública.
- **Rede:** publicar API por HTTPS reverse proxy ou Cloudflare Tunnel; listener
  da API em `127.0.0.1`. Token gateway em Vercel e VPS; OIDC/grants/CSRF continuam
  obrigatórios. Static IP Vercel Pro/Enterprise (documentado em US$100/mês/projeto
  Pro + transferência regional) deixa de ser requisito desta topologia.
- **Autenticação:** OIDC Authorization Code + PKCE na API Node da VPS, cookie
  seguro mesmo-origin através do proxy, sessão persistida e CSRF; issuer real e
  callback autenticado ainda pendentes.
- **Arquivos e tarefas longas:** filesystem da função não é armazenamento
  persistente. Imports XLSX e documentos precisam de object storage externo;
  tarefas duráveis/outbox exigem execução assíncrona gerenciada ou cron/queue.
- **Docker/.NET:** projetos, migrations SQLite, Compose e scripts da arquitetura
  anterior foram removidos do snapshot ativo. Evidências e regras históricas
  permanecem neste checklist; os recursos precisam ser reimplementados na stack
  Node.
- **Migrations:** migrations PostgreSQL reutilizáveis estão em
  `apps/api/migrations`; o runner Node aplicou M001–M007 no banco isolado da
  VPS e passou status, aplicação inicial e reaplicação. Em 2026-09-28, checksum
  divergente foi rejeitado, upgrade temporário M008 e concorrência passaram;
  veja as evidências no incremento atual. TLS de produção e CI continuam pendentes.
- **Dados locais:** ZIP, Excel, banco SQLite e SDK local ignorados foram
  preservados; não entram no Git e não foram apagados nesta limpeza.

Ao retomar em outra sessão, siga esta sequência:

1. Leia este arquivo e `Plano_Implementacao_ERP_PO_TOTVS.md`; não assuma que
   um item `[-]` está concluído.
2. Confirme que `Follow Up Import 2026 - Copiar.xlsx` continua ignorado e que o
   hash registrado em **Evidência da carga SQLite** não mudou.
3. Não apague `data/local/import_erp_test.db` para “resolver” testes. Quando
   for necessário reiniciar dados de teste, peça autorização explícita e registre
   o motivo no histórico.
4. Execute o próximo item da ordem abaixo; só pule um item quando houver uma
   dependência externa registrada em **Decisões e pendências abertas**.
5. Ao terminar, atualize o status do DEV correspondente, evidência, próximo
   passo e a tabela **Histórico de incrementos** antes de encerrar a sessão.

## Ordem de implementação e retomada

Esta é a ordem de trabalho. As etapas podem sobrepor atividades, mas os itens
da coluna **Condição para avançar** não podem ser ignorados.

| Ordem | Etapa | Itens do plano | Estado atual | Condição para avançar |
|---:|---|---|---|---|
| 0 | E0 — Fundação e contratos | DEV01–DEV05 | Parcial; frontend Next compila; portabilidade para Vercel, API Node, acesso PostgreSQL da VPS, OIDC em URL pública, E2E e CI pendem | API same-origin em Node, migration PostgreSQL, conexão segura VPS e testes automatizados |
| 1 | E1 — Modelo e diagnóstico | DEV05, DEV06, DEV09 | Parcial; modelo inicial e SQLite existem; migrations/fixtures completas não | Modelo revisado contra Pré e Pós Embarque |
| 2 | E2 — Migração histórica | DEV07–DEV12 | Parcial; staging/promoção/idempotência SQLite validados manualmente | Testes de parser e retry, reconciliação aprovada e tela de qualidade |
| 3 | E3 — Carteira PO e núcleo | DEV13–DEV15 | Parcial; lista/detalhe inicial de PO existem | Navegação completa por PO, permissões, pendências e auditoria |
| 4 | E4 — Atendimento e documentos | DEV16, DEV17, DEV23, DEV24 | Não iniciado | Linhas oficiais, alocações, invoice, documentos e auditoria verificados |
| 5 | E5 — Logística e fiscal | DEV18–DEV22 | Não iniciado | Shipment até entrega, fiscal e custos/rateios sem duplicação |
| 6 | E6 — Relatórios e BI | DEV25–DEV28 | Parcial somente no KPI inicial; BI não iniciado | Grãos, moedas, ETL, RLS e totais reconciliados |
| 7 | E7 — Qualidade e homologação | DEV29 | Não iniciado | E2E, segurança, performance, restauração e UAT aprovados |
| 8 | E8 — Corte e operação | DEV30 | Não iniciado | Snapshot final, treinamento, runbooks e aceite formal |

### Sequência exata do próximo bloco

1. Validar carteira, overview, histórico e escopo em PostgreSQL isolado; depois executar E2E autenticado DEV13, incluindo paginação e rastreabilidade.
2. Configurar issuer OIDC de homologação e fechar E2E de login, sessão, CSRF, logout e respostas 401/403/404 (DEV03/DEV04).
3. Executar `.github/workflows/api-ci.yml` em CI e validar identidade TLS aprovada antes de fechar DEV05.
4. Definir schema e regras aprovadas para dados operacionais antes de implementar edição, ETag/If-Match ou novos campos de negócio.
5. Validar pré-condições e permissões dos comandos de workflow; ligar evidências a cadastros e saldos quando esses módulos existirem (DEV15).
6. Implementar auditoria geral e outbox transacional (DEV24) antes de liberar módulos de invoice, logística, fiscal, documentos, custos rateados ou BI.

> Se houver dúvida entre duas tarefas, execute primeiro a que protege a
> integridade do dado ou torna a carga verificável; não avance para rateio,
> totalização entre moedas ou cálculo fiscal sem regra de negócio aprovada.

## Matriz de cobertura integral do plano (seções 1–34)

Esta matriz é obrigatória: toda seção do
`Plano_Implementacao_ERP_PO_TOTVS.md` tem um item correspondente. O status do
DEV associado não substitui o aceite desta linha. Quando o plano for alterado,
inclua aqui a nova seção ou subseção antes de implementar a mudança.

| Plano | Cobertura a manter | Status | Aceite/evidência necessária |
|---:|---|---|---|
| 1 | Uso do plano e precedência: PO central, somente valores salvos, Pré B:AZ e Pós no próprio grão | [-] | Revisão de cada incremento contra este checklist; testes provam que fórmula não é executada |
| 2 | Escopo, RF01–RF16 e limites explícitos do MVP | [ ] | Matriz de requisitos abaixo completa; itens fora de escopo não implementados como se fossem MVP |
| 3 | Diagnóstico verificável da fonte e valores de reconciliação | [-] | Relatório reproduzível da cópia de trabalho, com diferenças em relação aos números de referência do plano formalmente explicadas |
| 4 | ADRs 000–015 e proibições arquiteturais | [-] | ADRs versionadas, aprovadas e coerentes com código, dados, API e BI |
| 5 | Stack fixa, versões compatíveis e dependências travadas | [-] | SDK, lockfiles, imagens/digests e versões sem `latest` documentados e reproduzíveis |
| 6 | Topologia, módulos e fronteiras de escrita | [ ] | Diagrama atualizado; frontend não escreve banco; regras pertencem ao backend |
| 7 | Estrutura de repositório, projetos e responsabilidades | [-] | Estrutura criada; worker, testes, infra e configurações ainda precisam completar a organização prevista |
| 8 | Banco operacional/analítico, convenções, entidades, índices e migrations | [-] | Migrations PostgreSQL executadas do vazio ao upgrade, FKs/checks/índices e separação do DW validados |
| 9 | Propriedade dos valores, PO versus invoice, custos e autoridade TOTVS | [-] | Testes impedem uso de histórico como saldo oficial, duplicação de custo e substituição indevida de fonte mestre |
| 10 | Estados comerciais, atendimento e workflow logístico | [-] | Endpoints de estado/histórico/transição, regras de estados, permissões, evidências, motivo, ETag e journal implementados para PO/IP; faltam E2E e validação das evidências contra entidades operacionais |
| 11 | Espelhamento, divergências e fila de qualidade | [ ] | Política de precedência, resolução auditada e telas de divergência disponíveis |
| 12 | Pipeline histórico: leitura, staging, promoção, qualidade, reconciliação e reimportação | [-] | SQLite validou fluxo básico; falta relatório homologado, retry por falha e testes automatizados completos |
| 13 | API versionada, padrões, recursos e exemplos de contrato | [-] | OpenAPI completo, erros/paginação/filtros/autorização e cliente TypeScript gerado sem alteração manual |
| 14 | Interface, navegação, telas, acessibilidade e estados de UX | [-] | Carteira/detalhe inicial existem; todas as telas e critérios de usabilidade ainda precisam de aceite |
| 15 | Autenticação, autorização, perfis e matriz de permissões | [-] | OIDC local ainda requer E2E; DEV04 persiste identidade, papéis e escopos, mas faltam testes negativos autenticados e homologação Entra |
| 16 | Segurança de documentos e dados | [ ] | Upload/download autorizado, antivírus/validação definida, segredos protegidos e logs sem dados sensíveis |
| 17 | Ambiente de desenvolvimento, perfis e bootstrap | [-] | Compose, serviços locais e scripts seguros existem; falta executar o bootstrap/infra em máquina com Docker e demonstrar o fluxo de 45 minutos |
| 18 | Processamento assíncrono, consistência, jobs e outbox | [-] | Outbox transacional está gravada com atualização de PO, revisão de qualidade e workflow. `M006` adiciona lease, backoff/retry, dead-letter e inbox por consumidor; PostgreSQL usa `FOR UPDATE SKIP LOCKED`. Os checks locais de lease/retry/redelivery passaram; falta definir consumidores de negócio/integração externa. |
| 19 | Arquitetura analítica, ETL, fatos, métricas, modelo semântico e Power BI | [ ] | DW separado, grãos declarados, moedas não misturadas, RLS e refresh testados |
| 20 | Estratégia de testes e casos automatizáveis | [-] | Build manual validado; suíte unitária, integração, E2E, segurança e performance ainda pendem |
| 21 | Requisitos não funcionais | [ ] | Metas de desempenho, disponibilidade, observabilidade, acessibilidade, backup e segurança evidenciados |
| 22 | CI e entrega | [ ] | Pipeline com lint, build, testes, migration check, imagem e promoção controlada |
| 23 | Operação, recuperação, logs, backup e runbooks | [ ] | Exercício de restauração e runbooks aprovados |
| 24 | Etapas E0–E8, backlog DEV01–DEV30 e dependências | [-] | Ordem e status detalhados neste arquivo; cada DEV só encerra com seu aceite específico |
| 25 | Responsabilidades de produto, compras, fiscal, logística, dados, QA, DevOps e desenvolvimento | [!] | Responsáveis nomeados e aprovações registradas para cada decisão de domínio |
| 26 | Decisões de negócio pendentes e tratamento conservador | [!] | Cada decisão tem responsável, data, evidência e impacto; nenhuma regra fiscal/financeira presumida |
| 27 | Critérios para encerrar MVP e entrada em produção | [ ] | Checklist de saída completo, carga reconciliada, permissões reais, restore, treinamento e aceite formal |
| 28 | Definição de pronto de cada entrega | [ ] | Caso de uso, migration, API, backend, tela, auditoria, testes, logs, documentação, revisão e aceite demonstrados |
| 29 | Dicionário de mapeamento de todas as colunas Pré/Pós | [-] | Controle de cobertura de 51 colunas Pré e 43 Pós, com linhagem de arquivo/aba/linha/coluna e regra por campo |
| 30 | Contrato físico PO central, projeções, consulta e rastreabilidade | [-] | Tabelas/campos, constraints, overview e lista atendem ao contrato sem representar desconhecido como zero |
| 31 | Sequência da primeira entrega | [-] | Ordem preservada; divergência de contagens entre plano e cópia atual registrada e aguardando reconciliação |
| 32 | Riscos e respostas obrigatórias | [-] | Controles abaixo cobrem cada risco e são testados antes do corte |
| 33 | Pacote final da equipe | [ ] | Repositório, ADRs, migrations, OpenAPI, pipeline, tela, BI, evidências, guias e plano de corte entregues |
| 34 | Fontes de negócio/técnicas e controle de revisão | [-] | Fontes registradas; qualquer mudança de centralidade/grão/chave/rateio atualiza ADR, modelo, API, testes e BI juntos |

## Cobertura histórica das funcionalidades do MVP (RF01–RF16)

| RF | Funcionalidade | Status | Critério de aceite que falta ou foi atendido |
|---|---|---|---|
| RF01 | Autenticação e autorização | [-] | Sessão OIDC e escopo server-side de PO/qualidade/importação implementados; faltam E2E Keycloak, administração completa, anexos/exportações e Entra |
| RF02 | Cadastros | [ ] | Fornecedor, importador, produto, NCM e auxiliares com ativação e histórico |
| RF03 | Solicitações | [ ] | Solicitação nativa e fila independente para legado sem IP |
| RF04 | Execução logística por IP | [ ] | Criar, editar, pesquisar, filtrar, priorizar, cancelar, reabrir e encerrar IP |
| RF05 | Itens | [-] | Snapshot histórico existe; campos e itens operacionais completos pendem |
| RF06 | Carteira PO TOTVS | [-] | Lista/detalhe inicial existem; itens oficiais, atendimento confirmado e alocações parciais pendem |
| RF07 | Invoices | [ ] | Cabeçalho, itens, associação, documentos e divergências com PO |
| RF08 | Logística | [ ] | Shipments, BL, portos, agente, ETD, ETA e containers |
| RF09 | Desembaraço | [ ] | DUIMP, canal, marcos fiscais, NF, armazenagem e entrega |
| RF10 | Custos | [-] | Custos históricos por IP deduplicados; outros custos, estados, rateios e reversões pendem |
| RF11 | Documentos | [ ] | Upload, versão, download autorizado e vínculo ao processo |
| RF12 | Histórico e auditoria | [-] | Origem histórica é preservada; timeline e auditoria por campo/usuário/instante pendem |
| RF13 | Histórico Excel | [-] | Leitura, staging, promoção e reimportação manual validados; qualidade/reconciliação automatizadas pendem |
| RF14 | Dashboard e relatórios | [-] | KPI de ruptura inicial no backend; filtros, catálogo, atualização e relatórios pendem |
| RF15 | Administração | [ ] | Usuários, perfis, importadores, parâmetros e jobs |
| RF16 | Dados analíticos | [ ] | Banco analítico, cargas verificáveis e modelo semântico sem fato-a-fato |

## Controle completo do dicionário de mapeamento

| Origem | Cobertura obrigatória | Status | Aceite |
|---|---|---|---|
| Pré Embarque B:AZ | As 51 colunas, de `Necessity` até `Rupture Risk`, incluindo campos vazios, erros e valores históricos | [-] | Cada cabeçalho possui campo de origem, tipo, destino, regra de migração e linhagem conforme seção 29.1 do plano |
| Pós Embarque B:AS | As 43 colunas nomeadas, inclusive `Qty Ctnr Dem` vazia e custos por coluna | [-] | Cada cabeçalho possui campo de origem, tipo, destino, regra de migração e linhagem conforme seção 29.2 do plano |
| Fórmulas/células com erro | Somente valor armazenado e indicação de erro; jamais expressão executada | [x] | Leitor OpenXML não calcula fórmula; erro é preservado como pendência de qualidade |
| Valores financeiros | Decimal e moeda preservados; zero conhecido é diferente de vazio | [-] | Testes por moeda, precisão, zero, vazio e não totalização entre moedas |
| Datas e KPIs | Datas preservadas; KPI calculado por regra de negócio documentada | [-] | Fixtures para datas, status e KPI; referência temporal explícita no cálculo |

## Controle dos riscos obrigatórios (seção 32)

| Risco | Controle obrigatório | Status |
|---|---|---|
| IP virar centro comercial | PO central e vínculo N:N PO–IP | [x] |
| Linha oficial TOTVS ser inferida do histórico | Observação histórica separada de item oficial | [-] |
| PO ser consolidada pelo fornecedor | Chave de PO independente do fornecedor e divergência em qualidade | [-] |
| Rateio sem base aprovada | Nenhum rateio automático; saldo não rateado visível | [-] |
| Custo multiplicado em joins | Custo único por linha/coluna da origem e grãos separados | [x] |
| Histórico tratado como saldo oficial | Rótulo/origem e ausência de saldo confirmado até TOTVS | [-] |
| Linhas após autofiltro ignoradas | Leitura de todas as linhas de negócio | [-] |
| Fórmula recalculada | Leitura somente do valor salvo | [x] |
| Erro ficar apenas no log técnico | Pendência de qualidade consultável na interface | [ ] |
| Integração TOTVS presumida | Adaptador histórico até descoberta do conector real | [x] |
| Fiscal sem validação | Somente pago registrado; regras versionadas/aprovadas | [ ] |
| Corte sem congelamento | Janela de corte, snapshot e reconciliação de deltas | [ ] |

## Princípios que não podem regredir

- [x] A PO TOTVS é o centro do sistema; linhas repetidas formam histórico da mesma PO.
- [x] IP é relacionado à PO em N:N; custos pertencem ao IP e não são duplicados no join com PO.
- [x] A origem Excel é lida sem executar ou recalcular fórmulas.
- [x] Pré Embarque considera `Necessity` até `Rupture Risk`; Pós Embarque entra por IP.
- [x] A planilha original permanece preservada e é ignorada pelo Git.
- [x] KPIs são calculados pelo sistema com regras próprias, não por execução de fórmulas Excel.

## Situação histórica por item do plano (.NET/SQLite, antes da limpeza)

| ID | Status | Entrega / aceite resumido | Evidência atual | Próxima ação |
|---|---|---|---|---|
| DEV01 | [-] | Monorepo, lockfiles e SDK reproduzíveis | SDK 10.0.301, `pnpm-lock.yaml` e `packages.lock.json` por projeto foram fixados; README lista pré-requisitos. Validação em segunda máquina pendente | Executar `bootstrap` limpo em outra máquina e registrar duração/evidência |
| DEV02 | [-] | Desenvolvimento local reprodutível; Compose opcional | Docker Desktop instalado; containers Compose parados sem apagar volumes. SDK 10.0.301 local; restore NuGet, pnpm install travado e build Next.js passaram. Decisão atual: deploy Vercel não depende de Docker; VPS PostgreSQL será o banco de integração externo. | Manter Docker fora do deploy. Documentar perfil Node local e opcionalmente usar PostgreSQL local/teste para desenvolvimento/CI. |
| DEV03 | [-] | OIDC, sessão e homologação | Fastify agora contém Authorization Code + PKCE, transação persistida com state/nonce/verifier, callback, sessão PostgreSQL opaca, cookie HttpOnly/Secure/SameSite=Lax, `/auth/me`, CSRF e logout. M007 cria as tabelas de transação e sessão. Build passou; migration ainda não foi executada, issuer/client não foram configurados e fluxo real/E2E não foram validados. | Aplicar M007 no banco isolado; configurar issuer/client/callback de teste e validar state/nonce/PKCE, sessão, inatividade/expiração, CSRF e logout antes de produção. |
| DEV04 | [-] | Perfis e escopo por importador | A autorização `(issuer, subject)`, papéis e escopos existem no backend .NET/PostgreSQL legado. A nova API Node ainda precisa portar permissões, filtros server-side e respostas 401/403/404. | Portar identidade/grants e testar admin/restrito, CSRF e ocultação de PO fora do escopo via preview e Postgres segregado. |
| DEV05 | [-] | Schemas e migrations executam em CI | Runner explícito Node criado em `apps/api/src/migrate.ts`: ledger `migration.schema_migration`, SHA-256 contra edição de migração aplicada, advisory lock, transação por arquivo e comandos status/up; API não executa migrations no startup. A aplicação de produção exige credencial separada `MIGRATION_DATABASE_URL`. Instalação congelada e build passaram; banco de teste VPS e role dedicada foram provisionados, mas o runner ainda não foi exercitado contra PostgreSQL. | Executar status/up/reaplicação no banco isolado, cobrir upgrade/checksum/concorrência e integrar CI; qualquer alvo remoto requer autorização de ambiente e backup restaurável. |
| DEV06 | [ ] | Cadastros e aliases | Não iniciado | Modelar cadastros oficiais e regras de alias |
| DEV07 | [x] | Lote, hash, arquivo e linhas persistidos sem duplicidade | SQLite guarda lote, hash, linhas brutas e unicidade por aba/linha; staging inicial e repetido são validados automaticamente em banco temporário. | Manter a cobertura na CI. |
| DEV08 | [x] | Leitura de valores Excel sem executar fórmulas | Fixture e check executados: fórmula fornece somente o valor salvo, e são cobertos IP cancelado, IP/PO ausentes e PO repetida. | Manter a regressão na CI. |
| DEV09 | [-] | Normalização tipada de decimal, data, NCM e erros | Parser preserva o valor bruto; normalizador aplica Unicode/whitespace, caixa canônica para PO/IP/moeda/status e nomes conhecidos de importador. Separadores múltiplos em campos escalares viram `MIXED_SCALAR_VALUES` e bloqueiam vínculo automático. NCM ainda não recebe inferência de dígitos quando ambíguo. | Completar parsing decimal/data/NCM e validar a lista de sinônimos com Dados; regras sem confirmação continuam apenas mecânicas. |
| DEV10 | [x] | Reconciliação Pré/Pós por IP sem multiplicar processos | Relatório da cópia de trabalho executado: 204 IPs (195 em ambas, 9 só no Pré, 0 só no Pós), 420 custos por moeda. Product Owner aceitou em 2026-09-24 a referência da cópia: Pré 7.000/Pós 195. | Manter a reconciliação por IP e moeda na CI; reabrir somente se a fonte mudar. |
| DEV11 | [x] | Promoção retomável e idempotente | Check automatizado injeta falha antes do commit, confirma rollback de PO/IP/observação/custo, promove o mesmo lote na retomada e reinsere zero na reimportação. | Manter a cobertura na CI. |
| DEV12 | [-] | Tela de qualidade auditável | API e tela `/quality` listam pendências com filtro e valores de origem; `M002` registra revisão, responsável, justificativa e PO/IP propostos sem alterar a fonte. Check automatizado cobre fila, resolução e filtro. | Aplicar OIDC/perfis antes de usar a revisão fora do ambiente local e executar E2E quando o ambiente permitir. |
| DEV13 | [-] | Carteira e detalhe centrados em PO | Filtros, paginação, linhagem, pendências abertas, ETag/If-Match e escopo por importador implementados; build da API, checks de migration e TypeScript passaram. Smoke sem autenticação confirma 401 na API. Dados oficiais TOTVS e E2E autenticado ainda pendem. | Executar E2E autenticado; itens oficiais TOTVS e invoices seguem fora do escopo atual. |
| DEV14 | [-] | Solicitações e filas de pendência | A fila histórica inclui linhas de Pré Embarque sem PO e IP, inclusive lotes promovidos antes da regra explícita; não cria solicitação nem altera a origem. | Modelar solicitação nativa e sua regra de conversão após autenticação, perfis e workflow. |
| DEV15 | [-] | Workflow e histórico de transições | Regras de PO e IP, rotas GET de estado/histórico e POST de transição implementadas; `If-Match`, escopo, grants explícitos, motivo, evidência obrigatória e journal append-only persistido em SQLite/PostgreSQL. Status histórico é mapeado sem inventar transições, com evento inicial e linhagem do XLSX. Build API sem warnings. | Validar E2E; vincular pré-condições às entidades oficiais de item, invoice, shipment, documento e saldo quando cada módulo existir; habilitar saltos simplificados somente com justificativa/permissão própria. |
| DEV16 | [ ] | Alocações de PO por processo | Não iniciado; não há rateio automático | Definir saldo, quantidade e validações |
| DEV17 | [ ] | Invoices e comparação | Não iniciado | Modelar vínculo, moedas e não comparabilidade |
| DEV18 | [ ] | Embarques e marcos | Não iniciado | Modelar múltiplos shipments por IP |
| DEV19 | [ ] | Containers e alocações | Não iniciado | Preservar resumo legado e alocação fracionada |
| DEV20 | [ ] | Desembaraço e NF | Não iniciado | Modelar referências múltiplas com origem |
| DEV21 | [-] | Custos, rateio e reversões | Custos são deduplicados por linha/coluna de origem no IP; rateio/reversão pendentes | Implementar alocação explícita e conciliação por moeda |
| DEV22 | [ ] | Regras e benefícios fiscais aprovados | Não iniciado | Aguardar regra fiscal homologada |
| DEV23 | [ ] | Documentos versionados e autorizados | Não iniciado; filesystem da função Vercel não é storage permanente | Selecionar object storage externo privado, upload/download autorizado, retenção e credenciais server-side antes de implementar anexos |
| DEV24 | [-] | Auditoria e outbox | `M005/M006` implementam auditoria/outbox e dispatcher no .NET/SQLite/PostgreSQL legado. Sem consumidor aprovado; Vercel não executa worker residente. | Portar gravação atômica/auditoria para Node; escolher cron/queue ou worker externo persistente, limitar invocações e validar retry/idempotência antes de ativar consumidores. |
| DEV25 | [-] | Dashboard e exportação | KPI de risco de ruptura calculado no backend; dashboard/exportação completos pendentes | Definir catálogo e telas de indicadores |
| DEV26 | [ ] | ETL e dimensões analíticas | Não iniciado | Definir watermark e reexecução |
| DEV27 | [ ] | Fatos e medidas sem mistura de moedas | Não iniciado | Modelar fatos e medidas por grão |
| DEV28 | [ ] | Power BI e RLS | Não iniciado | Definir modelo semântico e RLS |
| DEV29 | [ ] | Qualidade não funcional | Não iniciado | Planejar benchmark, segurança e acessibilidade |
| DEV30 | [ ] | Corte e operação | Não iniciado | Criar runbooks, plano de corte e retorno |

## Evidência da carga SQLite de teste

| Verificação | Resultado |
|---|---:|
| Data da última validação | 2026-09-23 |
| Banco de teste | `data/local/import_erp_test.db` (ignorado pelo Git) |
| POs centrais promovidas | 338 |
| Linhas históricas de Pré Embarque com PO | 6.923 |
| IPs promovidos | 204 |
| Vínculos PO–IP | 460 |
| Custos promovidos sem duplicação | 420 |
| Pendências de qualidade preservadas | 309 |
| Reimportação do mesmo arquivo | 0 novos registros em todas as entidades |
| Hash da planilha original após validação | `EB9CB9F0B14D7BE75850DB63D8A562A0495422C80BE3EB1745BAF0DDC4A669A0` |

> Os números acima descrevem a cópia de trabalho fornecida e não substituem a
> reconciliação/homologação exigida para produção no plano.

## Decisões e pendências abertas

| Status | Tema | Tratamento atual | Responsável para confirmar |
|---|---|---|---|
| [!] | PostgreSQL da VPS | Banco isolado `erp_po_totvs_test` e role `erp_po_totvs_migrator` foram criados para validar migrations; não usar os bancos das aplicações existentes. A credencial e o banco operacional da API ainda não foram configurados. Manter a conexão da API em loopback/rede privada, role de runtime com privilégios mínimos, pool limitado e backup/restore testado; não publicar 5432. Firewall externa foi validada com 5432/6543/6379 bloqueadas. | Usuário / DevOps |
| [!] | Acesso HTTPS da Vercel à API VPS | Publicar somente a API via HTTPS reverse proxy ou Cloudflare Tunnel e autenticar o proxy com `VPS_API_TOKEN`; esta topologia não exige Static IP da Vercel nem conexão direta Vercel→PostgreSQL. Escolher e configurar domínio/DNS e método de exposição. | Usuário / DevOps |
| [!] | Provedor e credenciais OIDC | Configurar issuer/client/secret e callback HTTPS após escolher/provisionar provedor público; Keycloak local não é endpoint Vercel. | Usuário / TI |
| [!] | Storage e jobs serverless | Selecionar object storage privado e mecanismo cron/queue para imports/outbox; filesystem e worker residente não são assumidos na Vercel. | Arquitetura / Usuário |
| [!] | Dados oficiais TOTVS | A carga atual representa histórico Excel, não linhas oficiais de pedido | Compras / TI TOTVS |
| [!] | Rateio de custos | Nenhum rateio automático é aplicado; custos permanecem no IP | Importação / Financeiro |
| [!] | Conversão de moedas | Não há total consolidado entre moedas sem taxa aprovada | Financeiro |
| [!] | Regras fiscais | Sem cálculo fiscal presumido | Fiscal |
| [!] | Critérios antigos do plano | As contagens do plano diferem da cópia de trabalho analisada; usar a evidência de carga até reconciliação formal | Dados / Product Owner |
| [!] | Consumidores da outbox | ADR 010 já define PostgreSQL, sem broker/Redis inicial. Não há consumidor de negócio, destino externo, credencial ou política de reprocessamento manual aprovada; o dispatcher preserva mensagens pendentes sem consumidor e não finge publicação. | Arquitetura / Product Owner / DevOps |

## Histórico de incrementos

| Data | Incremento | Status | Evidência / observação |
|---|---|---|---|
| 2026-09-28 | DEV13 — overview de leitura e detalhe alinhado ao schema | [-] | Adicionado `GET /api/v1/purchase-orders/{id}/overview` com escopo, cobertura histórica, pendências ligadas à origem, IPs visíveis e custos no grão do IP. A tela usa overview/histórico paginado, mostra linhagem/desconhecidos e remove edição genérica e risco presumido. API build, 11 testes e build Next.js passaram. Sem conexão PostgreSQL, issuer ou E2E real. CI efêmera foi adicionada, ainda sem execução GitHub. | Validar integração PostgreSQL e E2E; executar workflow; schema de edição, TLS e issuer seguem pendentes. |
| 2026-09-28 | DEV04 — autorização server-side Fastify | [x] | `apps/api/src/authorization.ts` consulta grants pela identidade `(issuer, subject)` em cada chamada protegida, mapeia papéis da matriz, nega por padrão rota sem política, produz predicado parametrizado de escopo e preserva 404 fora do escopo. A lista de POs e o histórico paginado usam o predicado nas consultas SQL antes da paginação/busca por ID. Dez testes locais cobrem 401/403/404, filtro antes da paginação, papel desconhecido, revogação imediata e administração global restrita. `M003_access_control.sql` permaneceu intacta; sem migration nova. |
| 2026-09-25 | Runbooks alinhados à API Fastify atual | [-] | README, Vercel setup e runbook Hostinger agora descrevem OIDC/PKCE, sessão, CSRF, runner e bootstrap como implementações parciais, sem alegar validação. O runbook inclui o procedimento M001–M007 para banco isolado, com arquivo temporário de credencial em loopback; nada foi executado na VPS. |
| 2026-09-25 | DEV03 — bootstrap explícito do primeiro administrador | [-] | Adicionado `pnpm bootstrap:admin`, comando manual que exige opt-in, credencial PostgreSQL própria em loopback, identidade OIDC exata e escopos de importador explícitos. Usa transação e advisory lock; recusa se já houver administrador ou se a identidade já existir. O pacote local contém o comando, mas ele ainda não foi compilado nem executado; depende das migrations M003+ e de provisionamento de issuer/conta. |
| 2026-09-25 | DEV05 — ambiente de migration explícito | [-] | O runner agora exige `MIGRATION_ENV=isolated` ou `MIGRATION_ENV=production`; valores ausentes/inválidos encerram antes da conexão. Alvos remotos isolados continuam exigindo `ALLOW_REMOTE_MIGRATIONS=true`; produção continua exigindo `MIGRATION_DATABASE_URL` e `ALLOW_PRODUCTION_MIGRATIONS=true`. O pacote local foi atualizado; a alteração ainda não foi compilada ou exercitada. |
| 2026-09-25 | DEV03 — negar provisionamento OIDC automático | [-] | O callback agora procura a identidade `(issuer, subject)` em `identity.erp_user` e só cria sessão se a conta estiver previamente cadastrada e ativa. Login OIDC não cria nem ativa usuários. O pacote local foi atualizado, mas a alteração ainda não foi compilada nem validada com PostgreSQL/issuer. |
| 2026-09-28 | DEV05 — checksum, concorrência e upgrade isolados | [-] | `migrate:status` rejeitou checksum divergente em cópia temporária de M007; restauração foi confirmada e status voltou a 7/0. Duas execuções simultâneas de `migrate:up` com M008 temporária aplicaram a migration uma vez e zero vezes, respectivamente; status mostrou 8/0. A tabela e a linha M008 do ledger foram removidas em `erp_po_totvs_test`; arquivo/logs/env temporários foram removidos e o status final confirmou 7/0. A senha da role de teste foi redefinida sem registrar segredo. TLS self-signed com compatibilidade não valida produção; DEV03/DEV05 permanecem parciais. |
| 2026-09-25 | Retomada do plano e reconciliação do checklist | [-] | Corrigidos resumos de estado que ainda descreviam a API como scaffold sem OIDC. Dois commits locais seguem à frente de `origin/main`; push depende da autenticação já solicitada pelo Git Credential Manager. O pacote local contém a API e M001–M007, sem `.env`, `node_modules` ou `dist`. Nenhuma migration foi executada e nenhum issuer OIDC foi configurado/validado; o conteúdo SQL de M001 não foi alterado e a diferença local é somente de fim de linha. Próximo passo: após confirmação da autenticação, push, transferência e validação status/aplicação/reaplicação no banco de teste. |
| 2026-09-24 | Limpeza do snapshot da arquitetura anterior | [-] | Removidos projetos ASP.NET Core, SQLite, runner/migrations SQLite, Compose/Keycloak/Azurite e scripts .NET/Docker; migrations PostgreSQL reutilizáveis movidas a `apps/api/migrations`. `.gitignore` mantém ZIP, planilha, banco local e SDK fora do Git. API Node ainda sem paridade; o histórico Git anterior foi preservado, sem reescrita de histórico. |
| 2026-09-24 | Preparação operacional da VPS e documentação de funcionamento sem PC | [-] | README, setup Vercel, plano e checklist alinhados em Vercel Free + Next proxy + API Fastify/PostgreSQL na VPS. Modelos `deploy/hostinger/import-erp-api.service` e `nginx-api.conf.example` mais roteiro de instalação adicionados. Build Next.js e `tsc` da API passaram. Endpoints de negócio/OIDC, migrations da API e instalação real continuam pendentes; MCP Vercel não está disponível como ferramenta nesta sessão. |
| 2026-09-24 | Escolha e preparação da stack Vercel + PostgreSQL VPS | [-] | Product Owner escolheu Vercel Free para Next.js e API Node + PostgreSQL na VPS Hostinger. Documentada API persistente acessada por HTTPS reverse proxy/túnel e gateway token; banco/segredos ficam na VPS, sem porta 5432 pública. O PC pessoal pode ficar desligado após deploy e configuração de início automático dos serviços. Scaffold Node criado, mas endpoints de negócio/OIDC, migrations PostgreSQL, instalação na VPS e E2E seguem pendentes. MCP Vercel está em `~\\.codex\\config.toml`, mas não apareceu carregado como ferramenta nesta sessão; inspeção da conta pendente. |
| 2026-09-23 | Núcleo PO, leitura Excel, plano de promoção e interface inicial | [-] | PO central, histórico por linha, relação PO–IP e KPIs iniciais implementados; aceite integral do MVP pendente |
| 2026-09-23 | Ambiente SQLite de teste | [x] | Staging/promoção idempotentes validados com 338 POs, 6.923 linhas, 204 IPs, 460 vínculos e 420 custos |
| 2026-09-24 | Criação deste checklist versionado | [x] | Estado inicial consolidado a partir do plano e das validações executadas |
| 2026-09-24 | DEV05 — migrations SQLite versionadas | [-] | `M001_historical_core.sqlite.sql`, histórico `__import_erp_migrations`, baseline seguro e verificador temporário criados; execução local passou. CI segue pendente. |
| 2026-09-24 | DEV07–DEV10 — fixture, idempotência e reconciliação | [-] | Fixture OpenXML executada cobre data, decimal com vírgula, zero conhecido, fórmula com valor salvo, erro `#REF!`, IP cancelado, linhas sem PO/IP, PO repetida e IP exclusivo do pós-embarque. Staging/promoção/reimportação idempotentes e reconciliação por IP/moeda passaram em banco temporário; falta retry por falha e aceite da carga real. |
| 2026-09-24 | DEV10–DEV11 — retry e reconciliação da cópia de trabalho | [-] | Falha injetada antes do commit reverteu integralmente o lote; retomada e reimportação passaram. Reconciliação real: 204 IPs, 195 nas duas abas, 9 só no Pré, 0 só no Pós e 420 custos. Contagens 7.000/195 divergem das referências 6.940/190 e aguardam decisão de Dados/Product Owner. |
| 2026-09-24 | DEV01–DEV02 — lockfiles e infraestrutura local segura | [-] | Lockfiles .NET, Compose, realm local Keycloak, scripts PowerShell/Bash e README foram adicionados. A API compilou, os checks de migration passaram e o web build passou. Docker e Bash não estão instalados nesta máquina; a execução do Compose permanece pendente. |
| 2026-09-24 | DEV10, DEV12 e DEV14 — referência aceita e fila de qualidade | [-] | Product Owner aceitou 7.000 linhas Pré/195 Pós como referência da cópia. `M002_historical_quality_reviews.sqlite.sql`, endpoints e tela `/quality` registram revisão auditável sem editar origem. Build .NET e checks de migration passaram; TypeScript passou. Build Next compilou, mas o ambiente bloqueou processo auxiliar com `spawn EPERM`. |
| 2026-09-24 | DEV13 — paginação e filtros da carteira | [-] | `GET /purchase-orders` retorna página com total, filtros por PO/importador e limite máximo de 100; a carteira usa esses filtros e paginação. Build da API, checks de migration e TypeScript passaram. |
| 2026-09-24 | DEV13 — contrato da carteira e detalhe | [-] | A carteira ganhou filtros de fonte histórica, `hasNext` e indicadores explícitos de item/saldo não confirmados. O detalhe expõe pendências abertas, linhagem de aba/linha/valor e endpoint paginado de histórico; ETag/`If-Match` protege edição operacional. Testes de regra foram adicionados ao verificador; a execução final aguarda reconstrução dos artefatos locais .NET. |
| 2026-09-24 | DEV09 — normalização conservadora de células | [-] | `HistoricalValueNormalizer` padroniza espaços/caracteres invisíveis, caixa de identificadores, moeda/status e três importadores conhecidos. Valores escalares com quebra de linha, `;` ou `|` geram pendência de revisão e não participam de chaves ou vínculos. Valores brutos no staging permanecem intactos. |

| 2026-09-24 | DEV13 — validação local concluída | [-] | Build da API e do verificador .NET passaram sem warnings; checks de migration passaram; TypeScript passou. E2E e escopo por importador continuam pendentes. |
| 2026-09-24 | DEV03 — OIDC local e sessão web | [-] | Backend/frontend implementados com PKCE, cookie HttpOnly/Secure, CSRF e endpoints de login/me/logout; API compilou e smoke confirmou 401 sem sessão e redirects de login. Keycloak não disponível sem Docker daemon; callback real, CSRF autenticado, provisionamento e Entra ainda pendem. |
| 2026-09-24 | DEV04 — papéis e escopo por importador | [-] | `M003` cria o mapa de identidade `(issuer, subject)`, papéis e escopos; permissões explícitas filtram carteira antes da paginação e ocultam PO fora do escopo. A fila de qualidade e os comandos de importação também exigem permissão. Realm local traz `local-admin` exclusivamente para desenvolvimento. Build API, checks de migration/escopo e TypeScript passaram; E2E OIDC permanece bloqueado pelo daemon Docker inativo. |
| 2026-09-24 | DEV15 — workflows comerciais e logísticos | [-] | `M004` cria estado de workflow e journal; API oferece GET de estado/histórico e POST de transição para PO/IP. Regras da seção 10 validam sequência, permissões, evidências, justificativa, escopo e versão; promoção histórica registra estado inicial com origem. Build API passou sem warnings. E2E aguarda Keycloak ativo e parte das evidências depende de módulos operacionais futuros. |
| 2026-09-24 | DEV24 — trilha de auditoria e outbox | [-] | `M005` cria auditoria append-only (com proteção contra update/delete SQLite e trigger PostgreSQL) e outbox pendente. Edição operacional de PO, revisão de qualidade e mudança de estado salvam alteração, auditoria e evento numa transação; `GET /audit/{PO|IP}/{id}` pagina registros no escopo. IDs dos eventos são reutilizáveis para deduplicação; dispatcher, leases, retry e inbox de consumidor ficaram para a etapa assíncrona. |
| 2026-09-24 | DEV24 — dispatcher e inbox | [-] | `M006` adiciona lease, retry exponencial limitado, dead-letter e inbox única por consumidor. O dispatcher PostgreSQL faz claim com `FOR UPDATE SKIP LOCKED`; o check temporário cobre falha transitória, expiração de lease e redelivery idempotente. A execução não pôde ser concluída: o SDK 10.0.301 local não contém os resolvedores de workload requeridos e a restauração não alcança o NuGet. Não há consumidor/integração externa aprovada, portanto nenhuma mensagem é confirmada sem um consumidor registrado. |
| 2026-09-24 | DEV24 — validação do dispatcher | [-] | Com restore travado e MSBuild do SDK 11 preview usado somente como contorno para a instalação incompleta do SDK 10 local, a API e `MigrationChecks` compilaram; `MigrationChecks` passou. A prova cobre migrations M001–M006, falha transitória com retry, exclusão/recuperação de lease e redelivery sem segunda execução do consumidor. DEV24 permanece parcial pois não existe consumidor ou transporte externo aprovado. |
| 2026-09-24 | DEV02 — infraestrutura local em execução | [-] | Docker Desktop 4.92.0, Docker CLI 29.8.0 e Compose v5.5.1 instalados. `POSTGRES_HOST_PORT` é configurável; `.env` local usa 5433 porque o serviço PostgreSQL 17 do host ocupa 5432. `docker ps` executado fora do sandbox confirmou PostgreSQL, Keycloak, Azurite e OTEL saudáveis. A tentativa autorizada pelo usuário de parar o serviço PostgreSQL falhou por falta de permissão Windows. Volumes preservados. Bootstrap/migrations e API aguardam SDK .NET 10.0.301 visível. |
| 2026-09-24 | DEV02 — tentativa de liberar 5432 | [-] | `sc query` confirmou `postgresql-x64-17` em execução, PID 6540 ouvindo em `0.0.0.0:5432` e `[::]:5432`; `Stop-Service` foi tentado com autorização explícita do usuário, mas o Windows retornou que não é possível abrir o serviço. PostgreSQL Compose responde em `127.0.0.1:5433` (PID 31400); Keycloak discovery responde HTTP 200 em `127.0.0.1:8180`; Azurite responde na porta 10000. Para usar 5432, o serviço do host precisa ser parado por uma sessão administrativa. |
| 2026-09-24 | Preparação do frontend para Vercel | [-] | SDK .NET 10.0.301 instalado localmente em `.tools/dotnet` (ignorado pelo Git); restore NuGet travado passou. pnpm 12.6 instalou dependências com `allowBuilds: sharp` e lockfile congelado; `next build` passou. CLI Vercel autenticada. Containers Compose foram desligados sem remover volumes. A URL padrão do frontend ainda aponta para `localhost:5000`; API .NET e OIDC precisam de hospedagem pública para login e dados funcionarem. |

## Atualização do incremento atual

| Item | Status | Evidência | Próximo passo |
|---|---|---|---|
| DEV01 | [-] | Lockfiles pnpm das aplicações Next.js e Fastify estão versionados; instruções .NET/Compose foram removidas do README ativo. | Validar instalação congelada em checkout limpo/CI. |
| DEV02 | [-] | Docker/Compose não fazem parte da stack alvo. Banco `erp_po_totvs_test` e role `erp_po_totvs_migrator` foram criados na VPS; a conexão psql foi confirmada. Node 24.21.0 está instalado isoladamente em `/opt/node-v24`. A firewall foi validada externamente: 22/80/443 acessíveis; 5432/6543/6379 bloqueadas. Pacote transferido para `/tmp/api-migration-validation`, instalado e compilado na VPS. Commits e push permanecem adiados por instrução do usuário. | Quando solicitado, fazer push; configurar serviço persistente da API após validações de OIDC, segurança e operação. |
| DEV03 | [-] | Fastify implementa Authorization Code + PKCE, callback, sessão PostgreSQL, CSRF e logout; login exige identidade cadastrada e ativa. O comando `pnpm bootstrap:admin` provisiona administrador com escopos explícitos. Issuer/client, bootstrap e fluxo OIDC real/E2E ainda não foram configurados ou validados. | Configurar issuer/client de homologação, provisionar a conta autorizada e executar E2E de callback, sessão, CSRF e logout. |
| DEV04 | [x] | Grants por `(issuer, subject)`, matriz de papéis, escopo por importador e negação por padrão implementados. Carteira, overview e histórico usam guardas e predicados SQL. Onze testes Fastify locais cobrem 401/403/404, escopo antes da paginação, papel desconhecido, revogação e desconhecidos preservados. Sem PostgreSQL ou issuer real. | Reutilizar guards/predicados em novos handlers e executar integração/E2E com PostgreSQL isolado e identidade real. |
| DEV05 | [-] | Runner M001–M007 validado no banco isolado; checksum divergente foi rejeitado e concorrência/upgrade temporário passaram. `.github/workflows/api-ci.yml` adiciona build, testes e migrations em PostgreSQL efémero; CI GitHub e identidade TLS de produção ainda não foram validadas. | Executar workflow em PR/CI e validar TLS aprovado; manter migrations em alvos isolados. |
| DEV13 | [-] | API Node com carteira paginada/filtros, overview de leitura conforme M001–M007, IPs/custos no grão do IP e histórico paginado com linhagem. Escopo aplicado na PO e nos IPs; itens e saldo oficiais permanecem desconhecidos. A tela remove edição arbitrária/risco presumido. API build e 11 testes passaram; build Next.js/TypeScript passou. Sem integração PostgreSQL/OIDC real. | Validar API em PostgreSQL isolado e E2E autenticado; decidir schema/whitelist antes de escrita e ETag. |
| DEV15 | [-] | Regras de workflow e ETag permanecem especificadas na seção 10 e nas evidências históricas; endpoints/repositórios foram removidos com a implementação .NET. | Reimplementar estados/transições no Node com autorização, evidências, atomicidade e concorrência PostgreSQL. |
| DEV24 | [-] | SQL PostgreSQL de auditoria/outbox foi mantido; dispatcher, repositórios e checks .NET/SQLite foram removidos do snapshot. Evidência antiga não valida o runtime Node. | Portar gravação atômica, dispatcher/worker e inbox no Node; testar retry, leases e idempotência. |
| Vercel/produção | [-] | Proxy, health checks, modelos systemd/Nginx, runner PostgreSQL e rotas OIDC estão no código. Na VPS, instalação congelada e build passaram; no banco isolado M001–M007 foram aplicadas e reaplicadas sem pendências. Issuer/login real, autorização de negócio, endpoints operacionais e deploy seguem pendentes. | Configurar issuer de teste; validar OIDC, autorização, endpoints e operação da VPS antes da produção. |

### Incremento de 2026-09-25 — runner PostgreSQL para Node

| Item | Status | Evidência | Próximo passo |
|---|---|---|---|
| DEV05 | [-] | Adicionado `apps/api/src/migrate.ts` com ledger versionado, verificação SHA-256, advisory lock PostgreSQL e transação individual por migration. `migrate:status` mostrou 0 aplicadas/7 pendentes; `migrate:up` aplicou M001–M007; status confirmou 7 aplicadas/0 pendentes; reaplicação retornou 0 aplicadas. `corepack pnpm install --frozen-lockfile` e `corepack pnpm build` passaram na VPS. O Node 24.21.0 está em `/opt/node-v24` com checksum oficial validado; firewall externa bloqueia 5432/6543/6379. A conexão do teste usou TLS compatível com o certificado self-signed sem SAN e não comprova configuração TLS de produção. | Cobrir upgrade, checksum alterado e concorrência; documentar a execução do ledger/checksum e validar configuração TLS de produção antes do aceite DEV05. |
| DEV05 | [-] | Adicionado `apps/api/src/migrate.ts` com ledger versionado, verificação SHA-256 normalizada entre Windows/Linux, advisory lock PostgreSQL e transação individual por migration. Status inicial reportou 0/7; aplicação executou M001–M007; status final reportou 7/0; reaplicação aplicou 0. O build também passou na VPS. M007 cria estado OIDC e sessões. | Cobrir upgrade, checksum alterado e concorrência antes do aceite DEV05. |

### Incremento de 2026-09-25 — OIDC e sessão Fastify (parcial)

| Item | Status | Evidência | Próximo passo |
|---|---|---|---|
| DEV03 | [-] | Implementados Authorization Code + PKCE com `openid-client`, state/nonce/code_verifier persistidos e consumidos uma única vez, sessão opaca persistida (hash do token), cookie seguro, limite absoluto de 8h/inatividade de 30 min, `/auth/me`, token CSRF HMAC com validação de Origin e logout local. Callback só aceita conta `(issuer, subject)` previamente cadastrada e ativa em `identity.erp_user`; login não provisiona usuários. `M007_auth_sessions.sql` foi aplicada no banco isolado junto com M001–M006. O pacote compilou na VPS com sucesso. Nenhum issuer real foi configurado; bootstrap e fluxo OIDC real/E2E ainda não foram executados. | Configurar issuer de homologação, provisionar conta permitida via comando manual e executar E2E de callback, sessão, CSRF e logout; então portar autorização de negócio/escopo DEV04. |

### Validação operacional em 2026-09-25 — migrations PostgreSQL na VPS

| Item | Status | Evidência | Próximo passo |
|---|---|---|---|
| DEV05 / DEV03 | [-] | Pacote transferido e checksum conferido; instalação congelada e build TypeScript passaram na VPS. Em `erp_po_totvs_test`, status inicial: 0 aplicadas/7 pendentes; aplicação: 7 migrations; status final: 7 aplicadas/0 pendentes; reaplicação: 0 migrations aplicadas. O teste usou `sslmode=require` com `uselibpqcompat=true` devido ao certificado PostgreSQL self-signed sem SAN; validar TLS de produção separadamente. Arquivo temporário `/tmp/api-migration-validation.env` removido pelo usuário após o teste. Nenhum issuer foi configurado, nenhum login OIDC/bootstrap foi exercitado e o banco operacional não foi tocado. | Na retomada, recriar o arquivo temporário de ambiente com `umask 077`, sem compartilhar credenciais; testar que `migrate:status` rejeita checksum divergente numa cópia temporária de migration e restaurá-la; depois validar concorrência/upgrade e OIDC com issuer de homologação. |

### Validação operacional em 2026-09-28 — checksum, concorrência e upgrade

| Item | Status | Evidência | Próximo passo |
|---|---|---|---|
| DEV05 | [-] | Em `erp_po_totvs_test`, uma alteração de comentário somente na cópia temporária de M007 fez `migrate:status` falhar explicitamente com checksum divergente. `ARQUIVO_RESTAURADO` foi confirmado e status posterior voltou a 7/0. Para upgrade/concorrência, M008 temporária criou `public.migration_validation_upgrade_probe_20260928`; duas execuções simultâneas de `migrate:up` terminaram sem erro, uma aplicando M008 e outra zero. Status confirmou 8/0; `DROP TABLE`, remoção de uma linha do ledger e `COMMIT` limparam o banco de teste. M008 e logs temporários foram removidos; status final confirmou M001–M007 aplicadas e zero pendentes. O arquivo de ambiente modo 0600 foi removido após os testes; nenhum segredo foi registrado. A senha da role dedicada foi redefinida interativamente. O banco operacional não foi acessado. | Integrar checks à CI e validar TLS de produção antes do aceite DEV05; OIDC/bootstrap/E2E seguem pendentes para DEV03. |

### Ponto de partida para a próxima sessão

1. Não fazer commit nem push até nova orientação do usuário. Os dois commits
   locais continuam à frente de `origin/main`; a autenticação do Git Credential
   Manager ainda não foi concluída nesta sessão.
2. A VPS permanece com o banco isolado `erp_po_totvs_test` contendo M001–M007
   aplicadas. Checksums, concorrência e upgrade temporário foram validados; M008
   e a tabela/ledger de prova foram removidos. Status final: 7 aplicadas/0
   pendentes. Nenhuma operação foi feita no banco operacional.
3. O pacote permanece em `/tmp/api-migration-validation`; o arquivo de ambiente
   `/tmp/api-migration-validation.env` foi removido após os testes. A senha da
   role `erp_po_totvs_migrator` foi redefinida interativamente e não foi
   registrada. Se for necessário outro acesso, recrie o arquivo com `umask 077`
   e não compartilhe credenciais.
4. Próximo: validar endpoints Node DEV13 em PostgreSQL isolado; configurar issuer de homologação e executar E2E OIDC; rodar a workflow de CI em PR e validar TLS de produção. Comandos remotos, se necessários, devem ser enviados um por vez e aguardados antes do seguinte. Não marcar DEV03 ou DEV05 como concluídos até cumprir seus critérios.
5. O certificado PostgreSQL observado na VPS é self-signed e não tem SAN. O
   teste foi feito com `uselibpqcompat=true&sslmode=require`; isso não é
   validação de identidade do servidor nem configuração aprovada para produção.
6. Preservar `apps/api/migrations/M001_historical_core.sql`: a alteração local
   observada é de fim de linha e não deve ser incluída nem modificada sem revisão.
7. Preservar `hast.md` sem alterações; continua não rastreado.
8. DEV04 está concluído em teste local. Ao portar rotas já previstas no plano, exigir `permissionConfig(...)` no `config`, usar `importerScopePredicate(...)` na própria consulta antes de `LIMIT/OFFSET` e na busca por ID, sem bypass para Administrador. Rotas globais devem usar escopo `global` somente para `users.manage`. Não adicionar endpoints fora dos contratos existentes.

## Modelo para o próximo incremento

Copie esta linha para a tabela de histórico e atualize os itens afetados acima:

```text
| AAAA-MM-DD | nome do incremento | [ ] / [-] / [x] / [!] | arquivos alterados, teste executado, resultado e decisão pendente |
```

## Evidência atual do DEV13

| Data | Status | Evidência | Próximo passo |
|---|---|---|---|
| 2026-09-28 | [-] | A API Node agora oferece carteira paginada, overview de leitura e hist?rico paginado sob escopo por importador. Overview inclui cobertura/pend?ncias hist?ricas e IPs/custos no gr?o do IP; itens/saldo oficiais continuam desconhecidos. A tela mostra linhagem, pagina hist?rico e n?o oferece escrita arbitr?ria nem risco presumido. Build API, 11 testes e build Next.js/TypeScript passaram. Sem PostgreSQL/OIDC E2E real. | Validar com PostgreSQL isolado e sess?o OIDC de teste; definir schema/whitelist antes de edi??o e ETag. |
| 2026-09-24 | [-] | A implementação com filtros, paginação, linhagem e ETag existiu na API .NET removida. O frontend ainda espera esses contratos same-origin; a API Node atual não tem as rotas nem os repositórios. Os resultados de checks anteriores são evidência histórica, não validação da nova stack. | Portar contratos e escopo por importador para PostgreSQL/Node; validar filtros, paginação, ETag/If-Match e concorrência. Itens oficiais TOTVS e invoices continuam fora do escopo. |

## Evidência atual do DEV03

| Data | Status | Evidência | Próximo passo |
|---|---|---|---|
| 2026-09-25 | [-] | A API Node implementa rotas `/auth/login`, `/auth/callback`, `/auth/me`, `/auth/csrf` e `/auth/logout`; M007 adiciona persistência transitória OIDC e sessões. State/nonce/PKCE são validados e a sessão guarda somente hash do token. Build passou na VPS; M001–M007 foram aplicadas e reaplicadas no banco isolado. Issuer/client não configurados e fluxo real não testado. | Configurar issuer/client de homologação e validar callback, sessão, CSRF e logout; depois completar testes negativos e OIDC Entra. |
