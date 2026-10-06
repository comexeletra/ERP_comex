# Checklist atual de implementação — stack Node/Vercel/VPS

Atualizado em 2026-10-06. Este é o controle vigente para concluir o plano em
[Plano_Implementacao_ERP_PO_TOTVS.md](Plano_Implementacao_ERP_PO_TOTVS.md).

**Incremento M022–M024 publicado em 2026-10-06:** histórico operacional de PO/IP,
ciclo aberto/encerrado do IP e partida efetiva por IP. As migrations passaram
em cópia restaurada, preservando dados, grants e testes de integração. O banco
operacional está em 24/24; a API ficou `active` com health autenticado 200 e a
rota de acompanhamento responde 401 sem sessão (rota existente). Backup,
rollback e publicação Vercel estão registrados em
[deploy/hostinger/README.md](deploy/hostinger/README.md).

**Incremento M021 publicado em 2026-10-05:** opções operacionais selecionáveis,
cadastro de novos valores de entidades e grupo de produto foram adicionados à
API/interface. M021 passou em cópia restaurada, com backup verificável, e foi
aplicada ao banco (ledger 21/21); API publicada na VPS e health autenticado 200.
Detalhes e rollback em [deploy/hostinger/README.md](deploy/hostinger/README.md).
O aceite do perfil real que deve cadastrar POs continua dependendo do papel e
escopo atribuídos por um Master.

**M023 publicado:** cada IP tem ciclo explícito Aberto /
Encerrado, separado do status logístico. O analista pode encerrar ou reabrir com
justificativa, sem depender da etapa logística; IP encerrado fica bloqueado para
edição e novas alterações nas distribuições. Pré Embarque é acompanhado por PO;
Pós Embarque tem uma linha por IP e agrega as POs/itens da operação.

**Incremento M019–M020 publicado em 2026-10-04:** os campos complementares de
item/IP, documentos individuais de Invoice/BL/NF e os cálculos automáticos estão
na API e na página da PO. O release passou em cópia restaurada com backup
verificável, ledger 20/20 e Vercel `READY` para `46aab37`; detalhes em
[docs/ACOMPANHAMENTO_CALCULOS_PO.md](docs/ACOMPANHAMENTO_CALCULOS_PO.md) e
[deploy/hostinger/README.md](deploy/hostinger/README.md). Ainda falta aceite dos
analistas; a carga histórica atualizada será feita separadamente.

**Incremento M018 publicado em 2026-10-04:** novas rotas e telas de PO, item,
IP e distribuição de quantidades estão na VPS e na Vercel. O fluxo está descrito em
[docs/PRIMEIRO_FLUXO_OPERACIONAL_PO_IP.md](docs/PRIMEIRO_FLUXO_OPERACIONAL_PO_IP.md).
Os estados e números operacionais abaixo continuam referindo-se à implantação
M001–M017. M018 passou em PostgreSQL 17 isolado, cópia restaurada e release
controlado; ainda precisa de aceite dos analistas. Uma nova planilha histórica será
fornecida posteriormente; a carga e a reconciliação estão fora deste incremento.
[CHECKLIST_IMPLEMENTACAO.md](CHECKLIST_IMPLEMENTACAO.md) conserva a cronologia e
as evidências antigas, inclusive da implementação .NET/SQLite retirada do código.
Um item daquele histórico não está concluído na stack atual sem evidência aqui.
As evidências antigas de aceite autenticado são de 2026-10-03; em 2026-10-04,
M018 e a API foram verificadas na VPS sem novo aceite autenticado da interface.

## Como ler o estado

- `[x]` Entrega comprovada na stack atual para o escopo descrito na linha.
- `[-]` Parte implementada; ainda falta o aceite ou uma parte do contrato.
- `[ ]` Não há implementação operacional correspondente no repositório atual.
- `[!]` Depende de decisão ou fonte externa identificada.

**Fontes deste retrato:** código/configuração do checkout, migrations M001–M017,
documentos de entrega e evidências registradas no checklist histórico até 2026-10-03.
O banco operacional `erp_po_totvs_test` e a API na VPS foram verificados após
M013–M017: backup `erp_po_totvs_test_20261003T173247Z.dump` validado, M016/M017
confirmadas aplicadas (ledger 17/17), cópia restaurada e grants de menor privilégio
conferidos, serviço ativo e release da API concluído em `m017-api-20261003T173254Z`.
As flags de 277 linhas/306 células de erro foram conferidas
com os registros imutáveis de qualidade. Os grants das views também foram conferidos. Na Vercel pública, `/admin/outbox` respondeu 200, o bundle contém a
carteira nova está publicada e a API sem sessão respondeu 401. Em 2026-10-03, a
interface autenticada foi validada com perfil real Consulta e escopo ELETRA CWB,
ELETRA FOR e ELETRA MATRIZ: a lista de solicitações abriu sem erro e sem controles
de criação; estava vazia, sem solicitações nativas registradas. A API também
passou as verificações de saúde após aplicar c98c03d pelo console da VPS
(live 200, ready sem token 401, ready com token 200). Web CI e API CI passaram para
`ae9bd6b`; o deploy Vercel de `f41b2bc` está `READY`. A API CI
passou novamente para `1d1d771`, incluindo upgrade isolado de M013 para M014
com evento de teste preservado. As três CIs
passaram para `fa7c67e`. Os demais módulos não foram revalidados remotamente
nesta revisão. A evidência acima valida somente consulta de solicitações no
escopo exibido e ocultação dos controles de criação; não cobre escrita direta na
API, recursos fora do escopo, OIDC nem os demais módulos.
Neste recorte, **11 RF estão parciais e 5 ainda sem módulo operacional**; dos
30 DEV, **19 estão parciais e 11 sem implementação operacional**. Nenhum item
recebeu `[x]` integral apenas por existir na fase .NET/SQLite ou no plano.

## Stack vigente e divergências resolvidas

| Camada | Estado do checkout | Direção para conclusão |
|---|---|---|
| Frontend | Next.js 16.3.6, React 19.3.0, TypeScript 5.9.3, CSS próprio; `fetch` em componentes e `proxy.ts` same-origin; Vercel `apps/web` | Manter esta base. Tailwind, shadcn/ui, TanStack Query, React Hook Form, Vitest e Playwright são propostas do plano e **não estão instalados**. Adotá-los só quando uma entrega exigir. |
| API | Node 24, Fastify 5, TypeScript, Zod, `pg`; serviço `systemd` na VPS, HTTPS via Traefik, token de gateway | Completar contratos e workflows no serviço persistente. Não há backend .NET ativo. |
| Banco | PostgreSQL da VPS; `erp_po_totvs_test` é operacional apesar do nome; M001–M024 estão aplicadas. M022–M024 passaram em cópia restaurada, com backup, grants e contratos PO/IP conferidos. | Separar banco de CI/homologação do operacional e manter backup antes de novos releases. Não usar SQLite como evidência atual. |
| Autenticação | Login local e sessões PostgreSQL em uso; OIDC/PKCE existe no código; leitura de solicitações conferida com perfil Consulta real e três escopos atribuídos. | Homologar provedor corporativo e ampliar a validação real para logout/CSRF e outros recursos e casos de isolamento. |
| Importação | `deploy/hostinger/import-historical-workbook.py` usa Python/openpyxl e hash do arquivo aprovado; a origem bruta é preservada | Criar prévia, reconciliação e promoção versionada da próxima planilha; não pressupor importador Node já existente. |
| Jobs e arquivos | Outbox no PostgreSQL; sem consumidor operacional ou object storage escolhido | Definir executor persistente/agenda na VPS ou serviço gerenciado, storage privado e políticas de retry/retensão antes de documentos e integrações. |
| CI | `.github/workflows/api-ci.yml` compila/testa API, instala migrations do zero e testa upgrade com dado em PostgreSQL isolado; `.github/workflows/web-ci.yml` executa testes, ESLint e build; `source-preview-ci.yml` testa a prévia. As três passaram para `fa7c67e`; Web CI e API CI passaram para `6d4f75b`, e o gate de upgrade passou para `1d1d771`. | Acrescentar integração, contratos, segurança e E2E relevantes. |
| BI | Sem banco analítico ou projeto Power BI versionado | Implementar depois de fixar grãos, moeda e fonte de cada indicador. |

**Cobertura de colunas do arquivo aprovado:** o importador fixa o SHA-256 do
snapshot aprovado (`d2f025ce…d7f44`). O arquivo local disponível nesta revisão,
`Follow Up Import 2026 - Copiar.xlsx`, tem SHA-256 `eb9cb9f0…a669a0` e não foi
importado. A extração atual guarda Pré `B:AZ` e Pós `B:AS`. A própria
aba Pré aprovada já tem 11 cabeçalhos nomeados fora desse intervalo: `BB:BH` e
`BJ:BM` (com lacunas em `BA` e `BI`). Decidir quais desses campos auxiliares
entram na origem auditável e, se entrarem, expandir extração, cabeçalhos e grade
em lote versionado. A aba Pós não tem cabeçalho nomeado após `AS` na linha 4.

## Divergências identificadas neste incremento

- **Host canônico para sessão web:** a regra de redirecionamento dos aliases
  `*.vercel.app` não era executada em `/requests`, `/processes`, `/catalog`,
  `/source-audit` e nas duas filas legadas, porque essas páginas não estavam no
  matcher de `proxy.ts`. O matcher foi ampliado para cobrir todas as páginas
  operacionais atuais; as rotas `/auth/*` e `/api/v1/*` continuam no proxy para
  preservar o fluxo same-origin e o token de gateway server-side.
- **Isolamento de Preview:** o proxy agora seleciona `PREVIEW_API_URL` e
  `PREVIEW_API_TOKEN` em deployments Vercel que não sejam Production, sem fallback
  para as credenciais operacionais. `PREVIEW_PUBLIC_ORIGIN` fixa um alias HTTPS
  para sessão/CSRF; os aliases de deployment redirecionam para ele e o backend
  staging precisa usar a mesma origem em `APP_PUBLIC_ORIGIN`. Sem configuração
  própria, as páginas ou rotas da API respondem 503. A infraestrutura de staging
  e o banco de teste ainda precisam ser provisionados antes de habilitar Preview
  funcional.
- **Acessibilidade da auditoria de origem:** as abas de planilha agora seguem
  navegação por teclado com setas, Home e End, mantêm somente a aba selecionada
  na ordem de tabulação e associam o painel à aba ativa. O diálogo de filtro por
  coluna agora confina o foco, fecha com Escape e devolve o foco ao controle que
  o abriu; ao fechar por rolagem, não reposiciona a página. Os controles de ordem
  anunciam o estado selecionado. Ações repetidas nas listas de usuários,
  solicitações, cadastros, IPs e linhas históricas identificam o registro alvo
  em seu nome acessível. As demais verificações WCAG e E2E continuam pendentes.
- **Data do snapshot na carteira:** a versão anterior consultava
  `import_batch.promoted_at` e rotulava a data como promoção. O incremento atual
  calcula o maior `source_row.created_at` entre as linhas de origem ligadas às
  POs do recorte e alterou o rótulo para “Snapshot histórico registrado”. A data
  exibida representa a criação mais recente de uma linha de origem no recorte;
  não representa promoção do lote nem atualização do TOTVS. A migration M016
  continua concedendo leitura de `id`/`promoted_at` ao papel da API, mas esta
  consulta não usa esses campos.
- **Numeração das migrations:** já existe `M016_import_batch_snapshot_read.sql`.
  O histórico de cadastros preparado como M016 colidia com ela; foi renumerado
  para M017. Scripts de validação e release foram alinhados para aplicar M016 e
  M017 em ordem. API/Web CI passaram em `5962c5a` com M017 aplicado do zero. A API
  CI passou novamente em `51f345d`; o upgrade M016→M017 verificou grants da view,
  filtro de eventos e ausência de SELECT na tabela de auditoria. A VPS segue
  comprovada em M017; validação em cópia restaurada e release controlado foram
  concluídos em 2026-10-03, com backup operacional preservado.
- **Escopo da auditoria de cadastros:** o endpoint e a tela de histórico estão
  no checkout, enquanto o acesso da API ao view depende de M017. A migration e o
  deploy controlado foram concluídos; falta o aceite funcional com perfis reais.
- **Credencial SSH do cliente:** o usuário confirmou que o acesso à VPS está
  autorizado. A validação estrita da chave do servidor passou pelo IP
  `72.60.250.212`, já presente em `known_hosts`; o FQDN não tem entrada local,
  então o runbook agora orienta `HostKeyAlias=72.60.250.212`, sem desativar a
  verificação do host. A autenticação do cliente foi recusada para os usuários
  `root` e padrão (`publickey,password`): a chave privada documentada não existe
  no checkout atual nem no checkout anterior registrado, e não há identidade no
  `ssh-agent`. Foi gerado o candidato local `.local-keys/rf06_m017_recovery_ed25519`
  (fingerprint público `SHA256:TGiM4/V33UAHRLOXjWU0qikrq7bHR/Qn4mRH+kmjcBU`), mas
  sua chave pública foi cadastrada na VPS pelo console administrativo. O backup
  remoto foi verificado, a cópia restaurada foi validada e a validação M016/M017
  foi retomada e concluída na VPS; a API anterior ficou preservada para rollback.
- **Dependências do runner M017:** a revisão prévia para retomar o release mostrou
  que o migrador em `/tmp` resolve módulos pelo diretório do pacote e não encontra
  automaticamente `node_modules` instalado em `/opt/import-erp/apps/api`. O runner
  agora valida e liga o diretório de dependências instalado ao staging antes de
  consultar o ledger ou validar a cópia restaurada. O script ainda precisa ser
  executado na VPS para comprovar o caminho no ambiente real.
- **Cobertura da prévia de planilhas:** o inventário já lia cabeçalhos fora da
  faixa atual, mas não os destacava como alerta. O relatório agora expõe
  `headersOutsideCurrentExtraction` (inventário) e
  `candidateHeadersOutsideCurrentExtraction` (comparação), considerando Pré
  `B:AZ` e Pós `B:AS`. No arquivo aprovado, os 11 cabeçalhos Pré em `BB:BH` e
  `BJ:BM` continuam fora da origem importada e seguem aguardando decisão de
  escopo; o alerta não os inclui nem altera dados automaticamente.

Os dados históricos da planilha permanecem a fonte mestra até um corte formal.
Valores da origem são preservados; apenas erros de cálculo do Excel pedem revisão
histórica. Uma PO é a entrada central, mas um IP pode atender várias POs e uma PO
pode usar vários IPs. Custos históricos pertencem ao IP e não são rateados sem
política aprovada. Datas visíveis seguem `MM/DD/YYYY` e, com horário,
`MM/DD/YYYY HH:mm`.

## Requisitos do produto (RF01–RF16)

| RF | Estado | O que já existe na stack atual | O que falta para concluir |
|---|---|---|---|
| RF01 Acesso | `[-]` | Login local, sessões, Master, administração de usuários, papéis e filtros por importador na API. Cenário autenticado Consulta em solicitações com escopo ELETRA CWB, ELETRA FOR e ELETRA MATRIZ validado em 2026-10-03. | Homologar OIDC corporativo, sessão/CSRF/logout e ampliar os casos negativos de isolamento; o cenário atual cobre leitura da lista e ocultação dos controles de criação. |
| RF02 Cadastros | `[-]` | M010, `/catalog`, candidatos históricos separados de registros operacionais, criação/edição/inativação auditadas com idempotência e versão. Incremento local M017 acrescenta histórico paginado de mudanças do cadastro e tela de consulta. | Identidade oficial de importadora/empresa/filial, fornecedor, aliases conflitantes, produto/unidade e NCM/vigência aprovados; validar migration/API/UI na CI e homologar cadastro real. |
| RF03 Solicitações | `[-]` | M011/M012, criação nativa com itens descritos, listagem/detalhe, paginação e edição de `SUBMITTED` com `If-Match`, auditoria/outbox; filas legadas separadas. Consulta autenticada por perfil Consulta foi validada nos três importadores atribuídos; a lista estava vazia. | Decidir campos obrigatórios, estados/transições, cancelamento, permissões e regra de associação auditada das linhas legadas; validar escrita negada via API e concluir aceite funcional. |
| RF04 IP | `[-]` | Lista/detalhe de 200 IPs, POs vinculadas, linhas e custos históricos, filas sem IP/PO em leitura. | Comandos para criar/editar/priorizar/cancelar/reabrir/encerrar, versões, pré-condições e associação legada segura. |
| RF05 Itens | `[-]` | 6.796 observações históricas acessíveis na PO; itens descritivos de solicitação nativa. | Produto, unidade, quantidade, preço, moeda, finalidade, centro de custo e itens oficiais/operacionais com autoridade de fonte definida. |
| RF06 PO central | `[-]` | Carteira de 336 POs, filtros, detalhe, linhagem, IPs e custos mostrados no grão do IP. | Fonte TOTVS aprovada, fornecedor/estado comercial confirmados, linhas oficiais, saldo, atendimento e alocações quantitativas. |
| RF07 Invoices | `[ ]` | Referências preservadas na origem bruta. | Cabeçalho, itens, vínculos PO/IP, comparação e divergências auditáveis. |
| RF08 Logística | `[ ]` | Marcos e containers históricos preservados no bruto. | Shipments, BL, portos, agente, ETD/ETA, containers e relações operacionais. |
| RF09 Desembaraço | `[ ]` | DUIMP, NF e datas históricas preservadas no bruto. | Processo fiscal, documentos, armazenagem, marcos e entrega com regras aprovadas. |
| RF10 Custos | `[-]` | 422 custos históricos deduplicados por IP. | Lançamentos novos, aprovação, reversão, conciliação por moeda e rateio por PO aprovado. |
| RF11 Documentos | `[ ]` | Nenhum fluxo de upload/download operacional. | Storage privado, versões, autorização, vínculo e restauração. |
| RF12 Histórico/auditoria | `[-]` | Origem imutável, revisão de qualidade, auditoria e outbox em comandos existentes. M013 e M017 aplicadas após backup/cópia restaurada; histórico de solicitações e de cadastros ativos. API/Web CI passaram e o release M016/M017 foi concluído na VPS. Leitura restrita da lista de solicitações foi validada em 2026-10-03. | Ampliar timeline às demais entidades, criar consumidor da outbox e homologar históricos e demais telas com perfis reais. |
| RF13 Histórico Excel | `[-]` | Carga idempotente do snapshot aprovado; `/source-audit` com abas Pré/Pós, filtros e cabeçalhos; revisão de qualidade. CLI de inventário/comparação posicional de versões sem escrita no banco. | Decidir cobertura dos 11 cabeçalhos Pré além de `AZ` já no arquivo aprovado; reconciliar entidades de versões novas, promover sem sobrescrita e aceitar os erros de cálculo. |
| RF14 Painéis | `[-]` | API publicada na VPS; UI/CSV publicados na Vercel. API/Web CI passaram em `5962c5a`. Leitura no banco real confirmou 336 POs, 6.796 linhas, escopo e timestamp `source_row.created_at` do recorte. | Catálogo de KPIs oficiais por grão/moeda, referência temporal do TOTVS, relatórios completos e aceite dos valores. O resumo histórico não é saldo, atendimento oficial, valor comercial nem atualização do TOTVS. |
| RF15 Administração | `[-]` | Master gerencia usuários, papéis e escopos e pode consultar metadados da outbox. | Parâmetros operacionais, acompanhamento dos demais jobs e autorização completa para novos módulos. |
| RF16 Analítico | `[ ]` | Sem DW/ETL/modelo semântico ativo no repositório. | Banco analítico, cargas reconciliadas, fatos/dimensões, Power BI e RLS. |

Nenhum RF01–RF16 tem aceite integral registrado para a stack atual. Isso não
desfaz as entregas parciais: a coluna de implementação identifica o que pode ser
reaproveitado.

## Backlog técnico (DEV01–DEV30)

| DEV | Estado | Base comprovada e lacuna de aceite |
|---|---|---|
| DEV01 Monorepo | `[-]` | Projetos web/API e lockfiles pnpm existem; reproduzir instalação/build em checkout limpo e documentar versões exatas. |
| DEV02 Ambiente | `[-]` | Node 24 e PostgreSQL/VPS operacionais; CI web ativa e verde. Preview exige origem estável, variáveis de API separadas e falha fechado sem elas; ainda falta provisionar a API e o banco isolados de Preview. |
| DEV03 OIDC/sessão | `[-]` | Login local e sessões ativos; OIDC/PKCE no código. Homologar issuer corporativo, callback, expiração, CSRF e logout. |
| DEV04 Permissões | `[-]` | Papéis/grants e filtros SQL existem. Em 2026-10-03, perfil Consulta acessou a lista de solicitações no escopo de três importadores e não recebeu controles de criação. | Validar escrita negada diretamente na API e respostas 404 para recursos fora do escopo; cobrir as demais rotas com usuário restrito real. |
| DEV05 Migrations | `[-]` | Runner Node; M001–M018 versionadas. M013–M018 foram validadas em cópia restaurada, backup e grants operacionais conferidos; o release M016/M017 verificou a view de histórico e negou SELECT na tabela de auditoria. |
| DEV06 Cadastros/aliases | `[-]` | M010 e fluxo manual revisado; faltam identidades oficiais, aliases conflitantes e homologação de dados reais. |
| DEV07 Lote de origem | `[-]` | Snapshot, hash e linhas brutas persistidos; CLI local de inventário/comparação por coordenada versionada. Faltam recebimento, armazenamento e prévia reconciliada por entidade. |
| DEV08 Leitura Excel | `[-]` | Python/openpyxl lê valores salvos do arquivo aprovado; avaliar os 11 cabeçalhos Pré além de `AZ` já presentes e generalizar leitura de versões novas. |
| DEV09 Tipagem | `[-]` | Conversões conservadoras do importador atual; completar fixtures e regras para novos cadastros, sem alterar o bruto. |
| DEV10 Reconciliação | `[-]` | Pré/Pós conciliados no snapshot aceito; há relatório reproduzível de diferenças por célula entre arquivos. Faltam deltas por PO/IP/custo e aprovação de cada lote novo. |
| DEV11 Promoção | `[-]` | Reexecução histórica idempotente registrada; criar aprovação, falha/retomada e promoção de novos lotes. |
| DEV12 Qualidade | `[-]` | M008, API/tela de issues, resolução auditada e apresentação local da linha do tempo completa de revisões por pendência; falta CI/release e homologação com perfis reais e novos lotes. |
| DEV13 PO | `[-]` | Carteira/detalhe em leitura; faltam itens oficiais, saldo, atendimento e vínculo quantitativo. |
| DEV14 Solicitações | `[-]` | M011/M012, criação, edição de `SUBMITTED` e filas em leitura; perfil Consulta validado na lista com escopo real em 2026-10-03. Faltam workflow, associação legada e validação negativa de escrita na API. |
| DEV15 Workflow | `[ ]` | Há estrutura SQL histórica, sem comandos completos de transição PO/IP nesta API; definir estados e pré-condições. |
| DEV16 Alocações | `[ ]` | Sem alocação quantitativa oficial; depende de linha/quantidade TOTVS confirmada. |
| DEV17 Invoices | `[ ]` | Sem invoice operacional e comparação; definir vínculos, moedas e não comparabilidade. |
| DEV18 Embarques | `[ ]` | Sem shipment operacional; modelar múltiplos embarques por IP e marcos. |
| DEV19 Containers | `[ ]` | Apenas dados brutos; modelar containers e alocação fracionada sem inferir contagem física. |
| DEV20 Desembaraço/NF | `[ ]` | Apenas dados brutos; criar entidades fiscais e referências múltiplas aprovadas. |
| DEV21 Custos | `[-]` | Custos legados por IP; faltam custo novo, reversão e rateio versionado. |
| DEV22 Regras fiscais | `[ ]` | Sem cálculo/regra de benefício aprovada; depende do Fiscal. |
| DEV23 Documentos | `[ ]` | Selecionar storage privado e construir fluxo autorizado/versionado. |
| DEV24 Auditoria/outbox | `[-]` | Escrita atômica nos comandos existentes, histórico de solicitações M013 e monitor Master da fila M014 instalados. Faltam consumidor, política de retries e retenção. |
| DEV25 Dashboard | `[-]` | API VPS e UI Vercel publicadas; API CI passou em `915244b`, Web CI em `70714ba`; timestamp de captura da origem está validado no banco real. | Painel operacional, indicadores oficiais por grão/moeda, referência temporal do TOTVS, atualização e aceite com dados reconciliados. |
| DEV26 ETL | `[ ]` | Sem carga analítica; criar dimensões, watermark, reexecução e reconciliação. |
| DEV27 Fatos/medidas | `[ ]` | Sem fatos e medidas; impedir ligação fato a fato e soma entre moedas. |
| DEV28 Power BI/RLS | `[ ]` | Sem PBIP, refresh ou RLS; validar acesso por importador real. |
| DEV29 Qualidade não funcional | `[-]` | Testes API e checagens de deploy/backup registrados; faltam web E2E, acessibilidade, carga, segurança e recuperação do MVP completo. |
| DEV30 Corte/operação | `[-]` | VPS/Vercel e runbooks parciais; faltam treinamento, snapshot final, deltas, suporte, retorno e aceite formal. |

## Caminho crítico para encerrar o plano

1. **Fechar decisões de fonte e negócio** (`[!]`): Compras/TI TOTVS aprovam
   empresa/filial, linhas oficiais, fornecedor e quantidade; Product Owner define
   campos e workflow da solicitação/IP; Fiscal aprova NCM, impostos e vigências;
   Financeiro aprova rateio e conversão BRL/CNY. Registrar decisões no plano.
2. **Concluir o núcleo operacional**: RF02/RF03/RF04/RF05/RF06 com itens oficiais,
   associações e alocações sob controle de concorrência, preservando o bruto.
   Depois construir invoice, logística, desembaraço, custos e documentos
   (RF07–RF11). Cada entrega precisa do aceite da seção 28 do plano.
3. **Evoluir a importação**: decidir a cobertura das colunas Pré além de `AZ`
   presentes no arquivo aprovado. Ao receber uma nova planilha identificada,
   comparar hash, abas, cabeçalhos, linhas e entidades com o snapshot aprovado;
   apresentar prévia e reconciliação; promover como lote novo sem sobrescrita.
4. **Completar plataforma e evidência**: OIDC e usuário restrito real; storage,
   consumidor da outbox, CI web/API, E2E, segurança, acessibilidade e restauração
   integrada. Os testes autenticados relatados devem ganhar perfil, importador,
   caso e resultado para contar como aceite de escopo.
5. **Entregar analítico e corte**: estabilizar grãos/moedas, ETL e Power BI/RLS;
   validar indicadores com valores reconciliados; treinar usuários e realizar
   snapshot final, plano de retorno e aprovações de Importação, Compras, Fiscal
   e Logística. Só então declarar o plano concluído.

## Validação concluída em 2026-10-03

M016 e M017 foram aplicadas na VPS após backup verificável e restauração em cópia
isolada. O ledger operacional ficou em 17/17, os grants de menor privilégio da
view de histórico foram conferidos e a API foi instalada/reiniciada com rollback
da versão anterior preservado em `/var/backups/import-erp/m017-api-20261003T173254Z`.
O backup usado foi `/var/backups/import-erp/erp_po_totvs_test_20261003T173247Z.dump`.

## Aceite autenticado de solicitações em 2026-10-03

Captura fornecida pelo usuário confirma sessão com papel `Consulta`, escopo
`ELETRA CWB`, `ELETRA FOR` e `ELETRA MATRIZ`, acesso à página de solicitações,
ausência do formulário de criação e ausência de erro de autorização. A lista
informou que não há solicitações nativas registradas. A correção de permissão
`requests.read` para Consulta, Gestor e Logística está no commit `c98c03d`,
enviado a `production/main` e aplicada pelo console da VPS; não exigiu migration.
Após a reinicialização, a API respondeu `live 200`, `ready 401` sem token e
`ready 200` com token. Backup de código VPS:
`/var/backups/import-erp/request-read-policy-20261003T225946Z`.
Este aceite cobre apenas a leitura da lista pelo perfil Consulta e a interface;
não comprova escrita negada por chamada direta nem acesso a recursos fora do escopo.

## Registro anterior de próxima validação (superado)

Casos executados e decisões de produto/TOTVS estão registrados no plano, seções
24.4–24.5. O resumo da carteira foi publicado na API da VPS e na UI Vercel; as
API CI passou em `5962c5a`, Web CI em `5962c5a`, e o deploy Vercel está `READY`
em `5962c5a`. O timestamp de captura é lido de `source_row.created_at`, validado
no banco operacional em transação somente leitura e não requer migration. M016
passou na CI, mas permanece pendente na VPS; o resumo publicado não depende dela.
Preview continua desconectado do banco operacional. A mudança M017 de histórico
de cadastros passou na API/Web CI e no teste local do contrato; a API CI `51f345d`
passou o upgrade M016→M017. Faltam cópia restaurada e release controlado.
O acesso SSH documentado não está disponível neste checkout; restaurá-lo é
pré-requisito para validar a cópia na VPS.
O próximo aceite funcional é validar a interface e o isolamento com uma conta
restrita real; não havia grant restrito ativo no banco durante a última
verificação. As decisões de fonte/empresa/filial, itens oficiais e workflow
seguem com Compras/TI TOTVS e Product Owner.

**Validação em 2026-10-03:** builds Node/API e Next.js passaram; testes locais
anteriores passaram (29 API e 3 Web; lint sem erros, 22 avisos). Neste incremento,
build da API e 30 testes passaram, incluindo o contrato de histórico de cadastros.
API CI/Web CI passaram em `5962c5a`; API CI passou em `51f345d` com o gate
M016→M017. API e UI publicadas incluem carteira e timestamp; M017 segue sem
validação em cópia restaurada ou release. A matriz dos casos de homologação está no plano §24.4–24.5; nenhum
resultado histórico substitui o aceite funcional e de negócio.
