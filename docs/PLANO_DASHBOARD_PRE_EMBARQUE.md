# Tarefa: Dashboard de Pré Embarque (métricas do BI)

## Objetivo

Trazer para `/reports/pre` as métricas do painel Power BI de Pré Embarque: cartões por status, aging desde o envio
da PO, produtos por status, quantidade por status e a tabela de POs. Os gráficos seguem o modelo visual e o filtro
cruzado do End to End (`E2eOverviewCharts`).

## Decisões do usuário (2026-11-05)

- **Contagem por código de produto:** cada linha de produto conta 1 (uma por alocação ativa em IP mais o saldo
  sem IP, como no End to End). Não é contagem distinta: o HML tem cerca de 7,3 mil itens e 1.866 códigos distintos,
  e o total do BI (7.695) corresponde às linhas.
- **Cartões:** total de produtos e **um cartão para cada status** (A distribuir, Ag. produção, Ag. embarque,
  Ag. chegada, Desembaraço, Entregue, Cancelado). Não existe cartão "Waiting" somado.
- **Aging:** `Elapsed_Days_PO = hoje (Brasília) − PO Sent Date`, em dias. Linha sem PO Sent Date fica fora do
  gráfico, como no BI (`BLANK()`). Faixas: ≤ 45, 45–60, 60–90, 90–120, > 120 (limite superior incluído:
  45 → "≤ 45", 60 → "45–60").
- **Direct:** linha cuja finalidade é `Estoque Insumos (Componente)` ou `Estoque Insumos (Policarbonato)`.
  O filtro oferece Todos / Direct / Não direct.
- **Tabela:** fica na própria página, paginada, filtrada pelos mesmos filtros e cliques dos gráficos.

## Requisitos

1. **API** `GET /api/v1/reports/pre-shipment/summary` devolve, para os filtros:
   - `totalProducts` e `byStatus[status] = { products, quantity }` para os 7 status;
   - `aging[faixa] = { products, quantity }` para as 5 faixas, mais `agingWithoutSentDate`;
   - o filtro cruzado do End to End: cada gráfico ignora a própria seleção e segue as outras.
2. **API** `GET /api/v1/reports/pre-shipment/lines` devolve a página da tabela com: Necessity, Mode, Status,
   Requester, SC, PO, IP, ETD, ETA, ETE, código e descrição do produto, quantidade e unidade, fornecedor,
   importadora, finalidade e PO Sent Date. A ordem é necessidade, PO e linha.
3. **API** `GET /api/v1/reports/pre-shipment/filter-options` devolve os valores de demanda, solicitante,
   grupo, fornecedor, finalidade, importadora e modal.
4. **Filtros** (iguais para gráficos e tabela): Demand, Priority (Prioridade / Normal = vazia), Mode,
   Importer, Status, Date, Requester, Direct, Group, Supplier, Finalidade; buscas parciais por SC, IP, PO,
   código e descrição do produto.
5. **Tela:** linha de cartões (total e um por status, que filtram ao clicar), barras de aging, rosca de produtos
   por status, rosca de quantidade por status ("Priorities Resume") e a tabela. Clique e Ctrl+clique selecionam como no End to End.
   Os números contam até o valor novo (`useTweenedNumber`).
6. Os textos novos entram em `pt-BR.ts`, `en.ts` e `zh-CN.ts`.
7. As métricas atuais da carga (POs históricas e novas, itens alocados e status de identificação) continuam
   na página, numa seção recolhível abaixo do dashboard.

## Restrições

- Status calculado em SQL por `shipmentStatusSql` (mesma regra da Carteira e do End to End), sem rodar o
  cálculo E2E em JS: a rota agrega no banco.
- As rotas passam pela mesma fila de `work-gate.ts` das rotas do End to End (`server.ts` cria uma fila e a
  entrega às duas), e a tela espera os cliques pararem (`useDebouncedValue`) antes de pedir.
- Escopo por importadora (`importerScopes`) e permissão `purchase-orders.read`, como as linhas de produto.
- Cores só por tokens (`--color-chart-*`); componentes e classes seguem `docs/PLANO_VARREDURA_LAYOUT.md`.
  `Tooltip` em vez de `title`.
- As rotas existentes (`/purchase-order-lines`, `/e2e-stages`, `/reports/summary`) não mudam.

## Critérios de aceite

- [ ] Teste de API: faixas de aging nas bordas (45, 46, 60, 61, 90, 120, 121 dias) e sem PO Sent Date.
- [ ] Teste de API: filtro Direct, Priority Normal/Prioridade e filtro cruzado (status ignora a própria seleção).
- [ ] Teste de API: schema `.strict()` recusa parâmetro desconhecido com 400; sem permissão, 403.
- [ ] Teste de contrato web ↔ API: a query montada pela tela é aceita pela rota.
- [ ] Teste web: cartões e legendas seguem a ordem dos status; seleção por clique e Ctrl+clique.
- [ ] `i18n-coverage`, `layout-consistency` e `tooltip` passam.
- [ ] Ensaio só leitura no HML: os totais por status da rota batem com uma contagem SQL independente.
- [ ] Preview `homologacao` Ready e API HML com a versão nova respondendo à rota.

## Fora do escopo

- Exportação Excel da tabela (pode entrar depois, com catálogo próprio em `export-columns.ts`).
- Painel de Pós Embarque.
- Dados que não existem no banco.

## Decisões complementares (2026-11-05)

1. **Cancelados entram:** toda linha de PO `CANCELLED` e o saldo de item cancelado no TOTVS
   (`source_status` CANCELLED/CANCELED) contam como CANCELADO. A alocação de item cancelado no TOTVS mantém o
   status do IP, porque o material já foi destinado. As POs `DELETED` ficam fora. As outras telas não mudam.
2. **A distribuir entra no aging:** o aging conta A distribuir, Ag. produção e Ag. embarque.
3. **Filtro "Date" = necessidade:** período da necessidade, com o seletor de período do End to End.

## Plano

1. API: testes de `pre-shipment-dashboard.ts` (faixas, filtros, filtro cruzado, schema).
2. API: módulo `pre-shipment-dashboard.ts` com as três rotas; fila compartilhada em `server.ts`.
3. Web: `lib/pre-shipment-dashboard.ts` (query e parse dos filtros) com teste de contrato.
4. Web: componente `PreShipmentDashboard` (cartões, aging, roscas, tabela) e estilos em `features/`.
5. Web: textos nos três dicionários; métricas da carga numa seção recolhível.
6. Rodar testes, lint, type-check e build; revisar o diff; commit por etapa.
7. Push `homologacao`, release da API no HML, ensaio só leitura e validação do Preview.
