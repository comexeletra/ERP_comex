# Checklist atual de implementação — stack Node/Vercel/VPS

Atualizado em 2026-10-02. Este é o controle vigente para concluir o plano em
[Plano_Implementacao_ERP_PO_TOTVS.md](Plano_Implementacao_ERP_PO_TOTVS.md).
[CHECKLIST_IMPLEMENTACAO.md](CHECKLIST_IMPLEMENTACAO.md) conserva a cronologia e
as evidências antigas, inclusive da implementação .NET/SQLite retirada do código.
Um item daquele histórico não está concluído na stack atual sem evidência aqui.

## Como ler o estado

- `[x]` Entrega comprovada na stack atual para o escopo descrito na linha.
- `[-]` Parte implementada; ainda falta o aceite ou uma parte do contrato.
- `[ ]` Não há implementação operacional correspondente no repositório atual.
- `[!]` Depende de decisão ou fonte externa identificada.

**Fontes deste retrato:** código e configuração do checkout, migrations M001–M012,
documentos de entrega e evidências registradas no checklist histórico até
2026-10-02. A aplicação em `erp_po_totvs_test`, a API na VPS e os deployments
Vercel são fatos registrados nas entregas anteriores; esta revisão documental
não consultou os ambientes remotos. O commit `2ea54a5` dos cabeçalhos foi enviado
a `production/main`, mas não há evidência nesta revisão de que a API VPS o tenha
recebido. Aceites com usuários reais foram informados pelo usuário sem perfil,
importador e casos detalhados; não equivalem à validação de escopo restrito.
Neste recorte, **10 RF estão parciais e 6 ainda sem módulo operacional**; dos
30 DEV, **18 estão parciais e 12 sem implementação operacional**. Nenhum item
recebeu `[x]` integral apenas por existir na fase .NET/SQLite ou no plano.

## Stack vigente e divergências resolvidas

| Camada | Estado do checkout | Direção para conclusão |
|---|---|---|
| Frontend | Next.js 16.3.6, React 19.3.0, TypeScript 5.9.3, CSS próprio; `fetch` em componentes e `proxy.ts` same-origin; Vercel `apps/web` | Manter esta base. Tailwind, shadcn/ui, TanStack Query, React Hook Form, Vitest e Playwright são propostas do plano e **não estão instalados**. Adotá-los só quando uma entrega exigir. |
| API | Node 24, Fastify 5, TypeScript, Zod, `pg`; serviço `systemd` na VPS, HTTPS via Traefik, token de gateway | Completar contratos e workflows no serviço persistente. Não há backend .NET ativo. |
| Banco | PostgreSQL da VPS; `erp_po_totvs_test` é operacional apesar do nome; SQL M001–M012 versionado, runner explícito | Separar banco de CI/homologação do operacional; validar cada nova migration em cópia restaurada e manter backup. Não usar SQLite como evidência atual. |
| Autenticação | Login local e sessões PostgreSQL em uso; OIDC/PKCE existe no código | Homologar provedor corporativo e testar sessão/escopo com identidade restrita real. |
| Importação | `deploy/hostinger/import-historical-workbook.py` usa Python/openpyxl e hash do arquivo aprovado; a origem bruta é preservada | Criar prévia, reconciliação e promoção versionada da próxima planilha; não pressupor importador Node já existente. |
| Jobs e arquivos | Outbox no PostgreSQL; sem consumidor operacional ou object storage escolhido | Definir executor persistente/agenda na VPS ou serviço gerenciado, storage privado e políticas de retry/retensão antes de documentos e integrações. |
| CI | `.github/workflows/api-ci.yml` compila/testa API e aplica migrations em PostgreSQL isolado; `.github/workflows/web-ci.yml` instala, executa ESLint e compila o frontend | Confirmar execução no GitHub; acrescentar integração, contratos, segurança e E2E relevantes. |
| BI | Sem banco analítico ou projeto Power BI versionado | Implementar depois de fixar grãos, moeda e fonte de cada indicador. |

**Cobertura de colunas do arquivo aprovado:** o arquivo local
`Follow Up Import 2026.xlsx` confere com o SHA-256 aprovado no importador
(`d2f025ce…d7f44`). A extração atual guarda Pré `B:AZ` e Pós `B:AS`. A própria
aba Pré aprovada já tem 11 cabeçalhos nomeados fora desse intervalo: `BB:BH` e
`BJ:BM` (com lacunas em `BA` e `BI`). Decidir quais desses campos auxiliares
entram na origem auditável e, se entrarem, expandir extração, cabeçalhos e grade
em lote versionado. A aba Pós não tem cabeçalho nomeado após `AS` na linha 4.

Os dados históricos da planilha permanecem a fonte mestra até um corte formal.
Valores da origem são preservados; apenas erros de cálculo do Excel pedem revisão
histórica. Uma PO é a entrada central, mas um IP pode atender várias POs e uma PO
pode usar vários IPs. Custos históricos pertencem ao IP e não são rateados sem
política aprovada. Datas visíveis seguem `MM/DD/YYYY` e, com horário,
`MM/DD/YYYY HH:mm`.

## Requisitos do produto (RF01–RF16)

| RF | Estado | O que já existe na stack atual | O que falta para concluir |
|---|---|---|---|
| RF01 Acesso | `[-]` | Login local, sessões, Master, administração de usuários, papéis e filtros por importador na API. | Homologar OIDC corporativo, sessão/CSRF/logout e isolamento com usuário restrito real; registrar perfil/importador/casos. |
| RF02 Cadastros | `[-]` | M010, `/catalog`, candidatos históricos separados de registros operacionais, criação/edição/inativação auditadas com idempotência e versão. | Identidade oficial de importadora/empresa/filial, fornecedor, aliases conflitantes, produto/unidade e NCM/vigência aprovados; homologação de cadastro real. |
| RF03 Solicitações | `[-]` | M011/M012, criação nativa com itens descritos, listagem/detalhe, paginação e edição de `SUBMITTED` com `If-Match`, auditoria/outbox; filas legadas separadas. | Decidir campos obrigatórios, estados/transições, cancelamento, permissões e regra de associação auditada das linhas legadas; aceite completo. |
| RF04 IP | `[-]` | Lista/detalhe de 200 IPs, POs vinculadas, linhas e custos históricos, filas sem IP/PO em leitura. | Comandos para criar/editar/priorizar/cancelar/reabrir/encerrar, versões, pré-condições e associação legada segura. |
| RF05 Itens | `[-]` | 6.796 observações históricas acessíveis na PO; itens descritivos de solicitação nativa. | Produto, unidade, quantidade, preço, moeda, finalidade, centro de custo e itens oficiais/operacionais com autoridade de fonte definida. |
| RF06 PO central | `[-]` | Carteira de 336 POs, filtros, detalhe, linhagem, IPs e custos mostrados no grão do IP. | Fonte TOTVS aprovada, fornecedor/estado comercial confirmados, linhas oficiais, saldo, atendimento e alocações quantitativas. |
| RF07 Invoices | `[ ]` | Referências preservadas na origem bruta. | Cabeçalho, itens, vínculos PO/IP, comparação e divergências auditáveis. |
| RF08 Logística | `[ ]` | Marcos e containers históricos preservados no bruto. | Shipments, BL, portos, agente, ETD/ETA, containers e relações operacionais. |
| RF09 Desembaraço | `[ ]` | DUIMP, NF e datas históricas preservadas no bruto. | Processo fiscal, documentos, armazenagem, marcos e entrega com regras aprovadas. |
| RF10 Custos | `[-]` | 422 custos históricos deduplicados por IP. | Lançamentos novos, aprovação, reversão, conciliação por moeda e rateio por PO aprovado. |
| RF11 Documentos | `[ ]` | Nenhum fluxo de upload/download operacional. | Storage privado, versões, autorização, vínculo e restauração. |
| RF12 Histórico/auditoria | `[-]` | Origem imutável, revisão de qualidade, auditoria e outbox em comandos existentes. M013 e a tela/API de histórico de solicitações estão versionadas, ainda sem aplicação operacional. | Aplicar/validar M013, ampliar timeline às demais entidades e criar consumidor da outbox. |
| RF13 Histórico Excel | `[-]` | Carga idempotente do snapshot aprovado; `/source-audit` com abas Pré/Pós, filtros e cabeçalhos; revisão de qualidade. | Decidir cobertura dos 11 cabeçalhos Pré além de `AZ` já no arquivo aprovado; depois prévia/reconciliação de versões novas, promoção sem sobrescrita e aceite dos erros de cálculo. |
| RF14 Painéis | `[ ]` | Sem painel operacional completo. | Catálogo de KPIs por grão/moeda, filtros, atualização e relatórios. |
| RF15 Administração | `[-]` | Master gerencia usuários, papéis e escopos. | Parâmetros operacionais, acompanhamento de jobs e autorização completa para novos módulos. |
| RF16 Analítico | `[ ]` | Sem DW/ETL/modelo semântico ativo no repositório. | Banco analítico, cargas reconciliadas, fatos/dimensões, Power BI e RLS. |

Nenhum RF01–RF16 tem aceite integral registrado para a stack atual. Isso não
desfaz as entregas parciais: a coluna de implementação identifica o que pode ser
reaproveitado.

## Backlog técnico (DEV01–DEV30)

| DEV | Estado | Base comprovada e lacuna de aceite |
|---|---|---|
| DEV01 Monorepo | `[-]` | Projetos web/API e lockfiles pnpm existem; reproduzir instalação/build em checkout limpo e documentar versões exatas. |
| DEV02 Ambiente | `[-]` | Node 24 e PostgreSQL/VPS operacionais; separar desenvolvimento/Preview do banco operacional e completar CI web. |
| DEV03 OIDC/sessão | `[-]` | Login local e sessões ativos; OIDC/PKCE no código. Homologar issuer corporativo, callback, expiração, CSRF e logout. |
| DEV04 Permissões | `[-]` | Papéis/grants e filtros SQL existem; validar casos negativos e 404 fora do escopo com usuário restrito real. |
| DEV05 Migrations | `[-]` | Runner Node e M001–M012; cópias/backup registrados. Confirmar CI dinâmica no GitHub e gates de upgrade/release. |
| DEV06 Cadastros/aliases | `[-]` | M010 e fluxo manual revisado; faltam identidades oficiais, aliases conflitantes e homologação de dados reais. |
| DEV07 Lote de origem | `[-]` | Snapshot, hash e linhas brutas persistidos; falta receber/armazenar e comparar novas versões com prévia. |
| DEV08 Leitura Excel | `[-]` | Python/openpyxl lê valores salvos do arquivo aprovado; avaliar os 11 cabeçalhos Pré além de `AZ` já presentes e generalizar leitura de versões novas. |
| DEV09 Tipagem | `[-]` | Conversões conservadoras do importador atual; completar fixtures e regras para novos cadastros, sem alterar o bruto. |
| DEV10 Reconciliação | `[-]` | Pré/Pós conciliados no snapshot aceito; gerar relatório reproduzível de deltas para cada lote novo. |
| DEV11 Promoção | `[-]` | Reexecução histórica idempotente registrada; criar aprovação, falha/retomada e promoção de novos lotes. |
| DEV12 Qualidade | `[-]` | M008, API/tela de issues e resolução auditada; homologar perfis reais e cobertura dos novos lotes. |
| DEV13 PO | `[-]` | Carteira/detalhe em leitura; faltam itens oficiais, saldo, atendimento e vínculo quantitativo. |
| DEV14 Solicitações | `[-]` | M011/M012, criação, edição de `SUBMITTED` e filas em leitura; faltam workflow e associação legada. |
| DEV15 Workflow | `[ ]` | Há estrutura SQL histórica, sem comandos completos de transição PO/IP nesta API; definir estados e pré-condições. |
| DEV16 Alocações | `[ ]` | Sem alocação quantitativa oficial; depende de linha/quantidade TOTVS confirmada. |
| DEV17 Invoices | `[ ]` | Sem invoice operacional e comparação; definir vínculos, moedas e não comparabilidade. |
| DEV18 Embarques | `[ ]` | Sem shipment operacional; modelar múltiplos embarques por IP e marcos. |
| DEV19 Containers | `[ ]` | Apenas dados brutos; modelar containers e alocação fracionada sem inferir contagem física. |
| DEV20 Desembaraço/NF | `[ ]` | Apenas dados brutos; criar entidades fiscais e referências múltiplas aprovadas. |
| DEV21 Custos | `[-]` | Custos legados por IP; faltam custo novo, reversão e rateio versionado. |
| DEV22 Regras fiscais | `[ ]` | Sem cálculo/regra de benefício aprovada; depende do Fiscal. |
| DEV23 Documentos | `[ ]` | Selecionar storage privado e construir fluxo autorizado/versionado. |
| DEV24 Auditoria/outbox | `[-]` | Escrita atômica nos comandos existentes; leitura de histórico de solicitações versionada em M013, ainda sem release. Faltam consumidor, retries e monitoramento operacional. |
| DEV25 Dashboard | `[ ]` | Sem painel/exportação completos; definir indicadores por grão e referência temporal. |
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

## Próximo incremento verificável

Priorizar o registro dos casos de homologação já executados e das decisões de
produto/TOTVS, pois elas determinam o modelo dos itens oficiais. Em paralelo,
confirmar no GitHub a CI corrigida e preparar ambiente segregado de integração.
Nenhuma contagem histórica ou evidência .NET/SQLite substitui o aceite dos novos
comandos na API Fastify e no PostgreSQL.
