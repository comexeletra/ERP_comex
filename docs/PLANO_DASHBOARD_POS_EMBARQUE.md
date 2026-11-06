# Tarefa: Dashboard de Pós Embarque (métricas do BI)

## Objetivo

Trazer para `/reports/post` as métricas do painel Power BI de Pós Embarque: cartões, tabela de IPs, gráficos de
status, canal, prioridade, DSA e lead time por mês. A conta é por IP e usa os dados de pós-embarque do IP; os gráficos
seguem o modelo visual e o filtro cruzado do Pré Embarque (`docs/PLANO_DASHBOARD_PRE_EMBARQUE.md`).

## Painel de origem (Power BI)

- Filtros: Search IPs, Mode, Importer, Status, Priority, Date.
- Cartões: Qty Containers, IPs Total, On Waters, DSA - Target >= 70%, Avg LT Doc <= 7, Avg SLA TXT.
- Tabela "IPs Process (Delivery Date Reference)": Necessity, IP Number, Priority, Incoterm, Mode, Status, Duimp Date,
  Doc ok, Arrival, LT DOC, ETD, ETA, ETE, Delivery Date, Ctnr Qty, LT Clearance, Clearance Type, SLA TXT.
- Gráficos: IPs por Priority-Normal (rosca), IPs Status (barras), IPs channel (barras), DSA - Target >= 70% For Month,
  Average Lead Time For Month (Real-Time) e (Only Delivered), com variação contra o mês anterior e linha da média.

## Decisões do usuário (2026-11-06)

- **Grão:** uma linha por IP. **Universo:** todos os IPs não excluídos (`deleted_at IS NULL`); o analista recorta pelos
  filtros, inclusive o de status.
- **Fonte:** dados de pós-embarque do IP (`imports.import_process`), não das linhas de produto. As duas exceções são as
  do próprio BI (Power Query agrupando a aba Pré por IP): **Necessity** = menor necessidade entre os produtos do IP e
  **TXT date** = maior `IP Date Totvs` do IP. No sistema, o IP Date Totvs é campo do IP (`ip_totvs_date`); a
  necessidade vem dos itens das distribuições ativas do IP.
- **Data de referência** (relacionamento ativo do calendário no BI): a Delivery Date; sem ela, hoje. Ela define o mês do
  DSA e do Lead Time Real-Time e o filtro Date. O Only Delivered usa a Delivery Date (só IPs entregues).
- "Hoje" é a data de Brasília (`todayInBrasilia`), como no Pré Embarque. Datas vazias não geram número (o `DATEDIFF` do
  BI devolve vazio): sem Arrival não há LT DOC, LT Clearance nem SLA TXT.

### Medidas

| Medida | Regra | DAX de origem |
|---|---|---|
| Qty Containers | soma do Ctnr Qty (`container_quantity`, decimal) dos IPs do filtro | — |
| IPs Total | quantidade de IPs do filtro | `IPas pós` |
| LT DOC (por IP) | `Doc ok − Arrival` em dias; sem Doc ok (`documents_ok_date`), até hoje. Meta por modal: Air ≤ 2, Sea ≤ 7 (✅ dentro, ❌ acima; negativo é ✅); outro modal mostra só o número | `LeadTime_doc Status` |
| Avg LT Doc <= 7 | média do LT DOC dos IPs com Arrival | deduzida |
| LT Clearance (por IP) | `Delivery Date − Arrival`; sem entrega, até hoje. Verde ≤ 7 (inclui negativos), vermelho > 7, todos os modais | `lead_time` |
| SLA TXT (por IP) | `Arrival − TXT date` em dias | `arm_time` |
| Avg SLA TXT | média do SLA TXT dos IPs que o têm | `average SLA TXT` |
| Clearance Type | **On water** quando há DUIMP e ela é anterior à chegada, ou quando há DUIMP e o IP ainda não chegou; **Normal** nos demais (inclusive chegou sem DUIMP e DUIMP no dia da chegada) | `Clearense_water`, corrigido |
| On Waters | quantidade de IPs On water | `IPas pós` + filtro |
| DSA - Target >= 70% | IPs On water ÷ IPs do filtro; verde ≥ 70%, vermelho abaixo | `% water up water` |
| Status | status calculado pelas datas do IP (`shipmentStatusSql(p, null)`): Ag. produção, Ag. embarque, Ag. chegada, Desembaraço, Entregue, Cancelado; IP com registro `CANCELLED` é Cancelado | coluna Status |
| Canal | `customs_channel` (Green, Yellow, Red, vazio) | — |
| Priority-Normal | prioridade do IP preenchida (no HML, `Prioridade`) é Prioridade; vazia é Normal, como o filtro do Pré Embarque | — |
| DSA por mês | DSA dos IPs cuja data de referência cai no mês. **Mês com IPs e sem On water mostra 0%** e entra na média (diferente do BI, decisão do usuário); mês sem IP fica sem valor; a linha é a média dos meses com valor | `% water up water` |
| Lead Time Real-Time por mês | média do LT Clearance dos IPs com Arrival, pelo mês da data de referência | `averageLeadTime pós` |
| Lead Time Only Delivered por mês | média do LT Clearance dos IPs entregues com Arrival, pelo mês da Delivery Date | `averageLeadTime` |
| Variação mensal | `(mês − mês anterior) ÷ mês anterior`; ▼ verde quando cai, ▲ vermelho quando sobe; sem mês anterior, sem variação | — |
| Linha tracejada | média dos valores dos meses mostrados | — |

### Clearance Type: casos no HML

| Caso | IPs | BI | Sistema |
|---|---|---|---|
| DUIMP antes da chegada | 34 | On water | On water |
| Chegou sem DUIMP | 4 | On water (DUIMP vazia vale como anterior) | Normal |
| DUIMP sem chegada | 2 | Normal (chegada vazia) | On water |
| DUIMP no dia da chegada | 33 | Normal | Normal |

## Conferência no HML (2026-11-06, só leitura, ROLLBACK)

| Medida | BI (print) | HML |
|---|---|---|
| IPs | 222 | 224 (todos `ACTIVE`/`OPEN`, da carga histórica) |
| Status (Entregue / Ag. chegada / Ag. embarque / Desembaraço / Ag. produção) | 192 / 18 / 9 / 2 / 1 | 185 / 20 / 10 / 7 / 2 (calculado = manual nos 224) |
| Prioridade / Normal | 32 / 190 | 30 / 194 |
| Canal Green / vazio / Yellow / Red | 188 / 28 / 4 / 2 | 186 / 32 / 4 / 2 |
| Qty Containers | 229,50 | 227,00 (148 IPs com quantidade) |
| On Waters (regra do BI / do sistema) | 39 | 38 / 36 |
| Avg LT Doc | 17,53 | 17,86 |
| Avg SLA TXT | 38,91 | 39,21 (139 IPs com IP Date Totvs; 61 chegados sem ele) |
| Lead Time Real-Time, jan–nov/2026 | 27, 22, 13, 20, 13, 10, 10, 7, 9, 8, 20 | 27,2; 22,4; 12,9; 20,2; 13,3; 9,8; 10,3; 7,0; 8,7; 7,9; 20,0 |
| DSA jan / jul / set 2026 | 5,26% / 35,71% / 33,33% | 5,26% / 35,71% / 33,33% |

- O BI usa dados mais novos que a carga do HML (ex.: 064E com ETD 07/11/2025 no BI e 20/12/2025 no HML;
  `Lmao-011/2026` e `Nh-017/2025` não existem no HML). As diferenças vêm disso, não da regra.
- Na aba Pré da carga, nenhum IP tem IP Date Totvs divergente entre linhas: o maior valor é o do IP.
- Necessity: 221 dos 224 IPs têm produto distribuído com necessidade.
- Modais no HML: SEA 165, AIR 38, COURIER 21. Comparar sem diferenciar maiúsculas.

## Requisitos

1. **API** `GET /api/v1/reports/post-shipment/summary` devolve, para os filtros: `totalIps`, `containers`,
   `onWater`, `dsa`, `avgLtDoc`, `avgSlaTxt`, `byStatus`, `byChannel`, `byPriority` (filtro cruzado: cada gráfico
   ignora a própria seleção e segue as outras) e `byMonth[]` com `month`, `ips`, `onWater`, `dsa`, `leadTimeRealTime`,
   `leadTimeDelivered`.
2. **API** `GET /api/v1/reports/post-shipment/lines` devolve a página da tabela com as colunas do BI, na ordem do BI,
   e os valores calculados (LT DOC com a meta, LT Clearance, Clearance Type, SLA TXT). ETA e ETE são as confirmadas
   ou calculadas, como nas outras telas. Ordem: status (do fluxo), necessidade, IP.
3. **API** `GET /api/v1/reports/post-shipment/filter-options` devolve modais e importadoras.
4. **Filtros** (iguais para gráficos e tabela): Search IP (trecho), Mode, Importer, Status, Priority (Prioridade /
   Normal) e Date (período da data de referência, com o seletor de período do End to End). Cliques em status, canal,
   prioridade e no cartão On Waters filtram como no Pré Embarque (clique e Ctrl+clique).
5. **Tela** `/reports/post`: cartões, tabela paginada, rosca de prioridade, barras de status e de canal, colunas de
   DSA por mês (linha da meta de 70% e da média) e as duas colunas de lead time por mês (variação e média). Os números
   contam até o valor novo (`useTweenedNumber`).
6. As métricas atuais da carga (IPs históricos e novos, chegada, DUIMP, entrega, custos) continuam numa seção
   recolhível abaixo do dashboard.
7. Textos novos em `pt-BR.ts`, `en.ts` e `zh-CN.ts`.

## Restrições

- A rota agrega no banco por IP; o status usa `shipmentStatusSql` (mesma regra das outras telas).
- As rotas passam pela fila de `work-gate.ts` criada em `server.ts`, e a tela espera os cliques pararem
  (`useDebouncedValue`) antes de pedir.
- Escopo por importadora (`importerScopes`) e permissão `processes.read`, como `/reports/summary`.
- Schemas `.strict()`; cores só por tokens; `Tooltip` em vez de `title`; componentes de `docs/PLANO_VARREDURA_LAYOUT.md`.
- Nenhuma migration: todos os campos já existem no IP.
- As rotas existentes não mudam.

## Critérios de aceite

- [ ] Teste de API: LT DOC nas bordas da meta (Air 2/3, Sea 7/8, Courier sem meta, negativo, sem Doc ok, sem Arrival).
- [ ] Teste de API: LT Clearance e SLA TXT sem data; Clearance Type nos quatro casos da tabela.
- [ ] Teste de API: DSA com mês sem On water (0%), média dos meses, variação mensal sem mês anterior.
- [ ] Teste de API: data de referência sem entrega cai no mês de hoje; Only Delivered só com entrega.
- [ ] Teste de API: filtro cruzado (status ignora a própria seleção); schema `.strict()` recusa parâmetro com 400;
      sem permissão, 403.
- [ ] Teste de contrato web ↔ API: a query montada pela tela é aceita pela rota.
- [ ] Teste web: ordem dos status e legendas; seleção por clique e Ctrl+clique; colunas da tabela na ordem do BI.
- [ ] `i18n-coverage`, `layout-consistency` e `tooltip` passam.
- [ ] Ensaio só leitura no HML: os números da rota batem com a conferência acima.
- [ ] Preview `homologacao` Ready e API HML com a versão nova respondendo às rotas.

## Fora do escopo

- Exportação Excel da tabela (se entrar depois, segue o modelo de `docs/PLANO_EXPORTACAO_COLUNAS.md`).
- Custos (frete, impostos, multas, armazenagem, demurrage).
- Alterar dados de IP ou a carga histórica.

## Ajustes do usuário (2026-11-06, depois da primeira entrega)

- **Ordem da tela:** filtros, cartões de número, tabela de IPs e, depois, os gráficos.
- **Gráficos por mês** (DSA e os dois de lead time): não seguem o filtro Date e mostram todo o histórico, do mês da
  data de referência mais antiga ao mês de hoje, sem limite de meses (a área rola na horizontal). Seguem os demais
  filtros e as seleções. Substitui a proposta anterior (ano corrente; com o filtro, os meses do período).

## Padrões adotados (2026-11-06, a revisar com o usuário)

O usuário pediu para executar e rever depois estes pontos de acabamento:

1. **Cor do SLA TXT:** sem cor, na tabela e no cartão Avg SLA TXT (no print, 5 e 19 verdes e 27 a 396 vermelhos,
   mas o cartão de 38,91 está verde).
2. **Filtro Date:** usa sempre a data de referência (entrega ou hoje) em todas as medidas; o BI usa a Delivery Date
   em algumas. Só muda o resultado quando o período inclui hoje.

## Implementação

- API: `apps/api/src/post-shipment-dashboard.ts`. A consulta lê os IPs do escopo com os filtros que não são seleção
  (importadora, modal, trecho do IP); as medidas, o filtro Date e o filtro cruzado são calculados por IP em funções
  puras, testadas em `apps/api/test/post-shipment-dashboard.test.mjs`. ETA e ETE usam `shipmentDates` de
  `followup-calculations.ts`, a mesma regra das outras telas.
- O cartão On Waters é a seleção do tipo de desembaraço: clicar filtra os IPs On water; o próprio cartão e o DSA
  ignoram essa seleção.
- Web: `components/PostShipmentDashboard.tsx` e `PostShipmentCharts.tsx` usam os cartões, a legenda, os blocos e os
  tooltips do End to End e do Pré Embarque; as colunas por mês têm regras próprias em `features/analysis.css`.

## Plano

1. API: testes de `post-shipment-dashboard.ts` (medidas, bordas, filtros, filtro cruzado, schema).
2. API: módulo `post-shipment-dashboard.ts` com as três rotas na fila compartilhada de `server.ts`.
3. Web: `lib/post-shipment-dashboard.ts` (query, parse dos filtros, variação, média) com teste de contrato.
4. Web: `PostShipmentDashboard` e `PostShipmentCharts` (cartões, tabela, rosca, barras, colunas por mês) e estilos em
   `app/styles/features/`.
5. Web: textos nos três dicionários; métricas da carga na seção recolhível.
6. Testes, lint, type-check e build; revisão do diff; commit por etapa.
7. Push `homologacao`, release da API no HML, ensaio só leitura e validação do Preview.
