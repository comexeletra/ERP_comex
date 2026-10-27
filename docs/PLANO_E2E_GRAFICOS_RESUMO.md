# Plano de implementação — Gráficos de quantidade por status e por prazo no End to End

| Item | Valor |
|---|---|
| Data | 2026-10-27 |
| Branch de trabalho | `homologacao` (base: `8f8d123`) |
| Ambiente de validação | API HML na VPS (`import-erp-hml-api`) e Preview Vercel da `homologacao` |
| Status | **Implementado e publicado em HML; validação visual autenticada de A9 pendente** |

## 1. Resumo

O painel do Power BI tem dois gráficos de pizza que vão para o topo de `/end-to-end`:

1. **Quantidade de itens por status**: soma da quantidade de itens em cada status da linha, de *A distribuir* até *Entregue*. No Power BI o título é "Priorities Resume", que está errado; não use esse nome.
2. **Quantidade por situação do prazo**: soma da quantidade de itens em *No prazo*, *No limite*, *Atrasado* e *Sem dados*, pela fórmula `in_time_late` do Power BI (seção 3).

Os dois gráficos **somam a quantidade dos itens** (`quantity` de cada linha), não contam linhas. Cada fatia mostra o valor compacto e o percentual, por exemplo `729,05 mil (78%)`, com a legenda acima do gráfico. Os gráficos seguem os filtros aplicados (PO, importador, produto, IP, status, ETA e situação) e **não** mudam com a etapa selecionada nem com a animação, igual às contagens dos cards.

## 2. Contexto para quem vai implementar

### 2.1 Regras do projeto (resumo do `AGENTS.md`; leia o arquivo inteiro antes)

- Trabalhe na `homologacao` e preserve as alterações locais que não são desta tarefa: `apps/web/next-env.d.ts`, `FluxoE2E.css`, `FluxoE2E.jsx`, `docs/PLANO_CAMPOS_FORMULARIO.md`, `docs/PLANO_CICLO_VIDA_PO.md` e `eletra-logo.png`. Não as inclua nos commits.
- A mudança toca **a API e o web**. O Preview da Vercel não atualiza a API da VPS: publique e valide a API HML separadamente (etapa 7).
- Texto de tela nos três dicionários (`pt-BR`, `en`, `zh-CN`). Os status continuam em português na API; só a exibição é traduzida (`statusLabel`).
- Cores literais só em `tokens.css`, redefinidas no tema escuro. Classes novas com regra própria em `app/styles/features/e2e.css`.
- Módulos de `lib/` não importam valores entre si; funções que geram texto recebem `m: Messages`.
- Antes de afirmar algo sobre os dados, consulte o banco **HML** (`erp_po_totvs_hml`) em sessão somente leitura. Nunca o `erp_po_totvs_test`, que é produção.

### 2.2 Comandos

| Verificação | `apps/web` | `apps/api` |
|---|---|---|
| Testes | `pnpm test` | `pnpm test` |
| Lint | `pnpm lint` | — |
| Type-check | `pnpm exec tsc --noEmit` | `pnpm build` (`tsc`) |
| Build | `pnpm build` | `pnpm build` |

O `next build` reescreve `next-env.d.ts`; não commite essa alteração.

### 2.3 O que já existe

| Peça | Onde | Uso neste plano |
|---|---|---|
| Resumo de todas as linhas filtradas | `queryE2eStageSummary` e `summarizeE2eStages` em `apps/api/src/shipment-lines.ts:156-196`; rota `GET /api/v1/purchase-order-lines/e2e-stages` | Recebe os totais novos. Já calcula todas as linhas (cerca de 100 ms com 225 linhas no HML, em 2026-10-26) |
| Status da linha | `shipmentLineStatuses` (`shipment-lines.ts:12`) | Fatias do gráfico 1 |
| Quantidade da linha | `line.quantity` (texto de `line_quantity`), montado em `calculateLines` (`shipment-lines.ts:209`) | Valor somado nos dois gráficos |
| Atraso total | `calculateE2e(...).totalDelayDays` (`followup-calculations.ts:186`): `totalActualDays − totalTargetDays`, ou `null` se alguma etapa não tem meta ou dias reais (datas previstas, como ETD, ETA e ETE, contam) | Base do gráfico 2 |
| Linhas canceladas | `inFlow` (`shipment-lines.ts:140`) | Ficam fora dos dois gráficos, como já ficam fora das contagens |
| Tela | `apps/web/components/E2eLinesView.tsx`; o resumo chega em `counts` | Renderiza os gráficos |
| Biblioteca de gráficos | não há | Desenho em SVG próprio (R4) |

## 3. Decisões (fechadas com o usuário em 2026-10-27)

| # | Decisão |
|---|---|
| D1 | O gráfico 1 agrupa pelo **status da linha**: A distribuir, Aguardando produção, Aguardando embarque, Aguardando chegada, Desembaraço e Entregue, nessa ordem. Título: "Quantidade de itens por status". |
| D2 | Os dois gráficos **somam a quantidade dos itens** de cada linha. Não há seletor para contar linhas. |
| D3 | A situação do prazo vem da fórmula `in_time_late` do Power BI, aplicada ao `totalDelayDays` da linha, em aberto ou entregue. |
| D4 | Linhas entregues usam a mesma regra, pelo `totalDelayDays`. |
| D5 | Os gráficos ficam **logo abaixo da barra de controles e da ajuda da visão**, antes dos indicadores do Modelo (`E2eModelSummary`). |

Fórmula de origem (Power BI):

```dax
in_time_late =
VAR _Delay = 'End-to-end'[Total DelayDays]
RETURN
    SWITCH (
        TRUE (),
        ISBLANK ( _Delay ), "No data",
        _Delay > 0, "Late 🔴",
        _Delay = 0, "On limit 🟡",
        "In time 🟢"
    )
```

Regra equivalente na API, avaliada nesta ordem:

1. `CANCELADO`: fora do gráfico.
2. Sem cálculo E2E, ou `totalDelayDays === null`: **Sem dados** (`noData`).
3. `totalDelayDays > 0`: **Atrasado** (`late`).
4. `totalDelayDays === 0`: **No limite** (`onLimit`).
5. `totalDelayDays < 0`: **No prazo** (`onTime`).

Esse "Atrasado" é o atraso total da linha. Ele é diferente do botão "Só atrasados", que usa o prazo da etapa atual (`currentStageLate`). Não tente igualar os dois.

## 4. Especificação

### Objetivo
Mostrar no topo do End to End, para os filtros aplicados, a quantidade de itens por status da linha e por situação do prazo, no lugar do painel do Power BI.

### Requisitos

**R1. API — totais no resumo** (`apps/api/src/shipment-lines.ts`)
- `summarizeE2eStages` passa a devolver também:
  ```ts
  overview: {
    byStatus:   Record<"A DISTRIBUIR" | "AGUARDANDO PRODUÇÃO" | "AGUARDANDO EMBARQUE" | "AGUARDANDO CHEGADA" | "DESEMBARAÇO" | "ENTREGUE", { quantity: string; lines: number }>;
    byDeadline: Record<"onTime" | "onLimit" | "late" | "noData", { quantity: string; lines: number }>;
  }
  ```
- `byStatus` usa `line.calculated.status`. `byDeadline` usa a regra da seção 3.
- Todas as chaves vêm sempre, com `"0"` e `0` quando vazias, nesta ordem: as de status na ordem do fluxo; as de prazo como `onTime`, `onLimit`, `late`, `noData`.
- `quantity` é a soma exata de `line.quantity`, devolvida como texto decimal sem zeros à direita (por exemplo `"1234.5"` e `"0"`). Para não acumular erro de ponto flutuante, some como inteiros escalados com `BigInt`. Antes de escolher a escala, confira nas migrations a escala da coluna de quantidade da alocação e do item, e use a maior.
- `lines` conta as linhas de cada fatia. A tela não mostra esse número no gráfico; ele serve para conferência (A3 e A8) e para o `title` da fatia.
- A soma das `lines` de `byStatus` e de `byDeadline` é igual a `totalCount`.
- A mudança é **aditiva**: `totalCount`, `delivered` e `stages` não mudam, e a rota continua com os mesmos parâmetros. Um web antigo ignora o campo novo, e o web novo precisa funcionar sem ele (R5).

**R2. API — classificação do prazo** (`apps/api/src/followup-calculations.ts`)
- Nova função pura e exportada `e2eDeadlineStatus(e2e: { totalDelayDays: number | null } | null): "onTime" | "onLimit" | "late" | "noData"`, com os passos 2 a 5 da seção 3. O passo 1 (cancelado) fica no resumo, pelo `inFlow` existente.

**R3. Web — geometria da pizza** (`apps/web/lib/pie-chart.ts`, novo)
- Função pura `pieSlices(values: number[], options)` que devolve, por fatia, o caminho SVG (`d`), a fração e a posição do rótulo externo e da linha guia.
- Começa às 12 h e segue no sentido horário, na ordem recebida. Fatias com valor zero não geram caminho.
- Uma fatia com 100% vira um círculo completo (dois arcos); total zero não gera fatias.
- Fatias abaixo de 2% não têm rótulo externo, para não sobrepor; o valor delas aparece na legenda e no `title`.
- Sem texto e sem imports de valor de outros módulos de `lib/`.
- As quantidades chegam como texto; converta para `Number` só para desenhar e calcular a fração. O texto exibido vem da formatação (abaixo).

**R4. Web — componente** (`apps/web/components/E2eOverviewCharts.tsx`, novo)
- Dois cards lado a lado (`.e2e-overview`, cada um `.card`). Abaixo de 760 px, ficam empilhados.
- Cada gráfico é um `<svg role="img" aria-labelledby>` com `<title>` (`chartLabel`). A legenda fica acima do gráfico, como uma lista visível com cor, rótulo, quantidade e percentual; ela é o equivalente textual do gráfico. Cada fatia tem `<title>` com a quantidade completa (`formatNumber`) e o número de linhas.
- Rótulo externo da fatia: quantidade compacta e percentual, como `729,05 mil (78%)`.
  - Compacto: `Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 })`, que dá `729,05 mil` em pt-BR, `729.05K` em en e `72.9万` em zh-CN.
  - Percentual: `Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits })`, com 0 casas a partir de 1% e até 3 casas abaixo de 1%, como o `0,020%` do Power BI.
- Fatias separadas por contorno de 2 px na cor `--color-surface`.
- **Gráfico 1:** clicar numa fatia ou num item da legenda aplica o filtro **Status** da tabela, pela mesma função `applyFilters` do formulário; o campo Status do formulário também muda. Os itens da legenda são `button` com `aria-label` (`filterByStatus`) e `aria-pressed` quando o status está filtrado.
- **Gráfico 2:** somente leitura nesta entrega (ver Fora do escopo); a legenda é uma lista simples.
- Estados: `loading` enquanto `counts` não chega; o erro do resumo continua no aviso existente; com quantidade total zero, mostra `empty` no lugar do gráfico.

**R5. Web — integração** (`E2eLinesView.tsx`)
- O tipo `StageSummary` ganha `overview?` opcional. Sem `overview` (API antiga), os gráficos não aparecem e a tela continua como hoje.
- `<E2eOverviewCharts>` entra logo depois do parágrafo de ajuda da visão (`<p className="muted">…`) e do aviso de erro do resumo, antes de `<E2eModelSummary>`.
- Recebe `counts?.overview`, `locale`, o status aplicado (`applied.status`) e um callback que faz `setDraft` e `applyFilters` com o status novo e os demais filtros aplicados.

**R6. Cores** (`apps/web/app/styles/tokens.css`)

A paleta parte das cores da logo: o azul da marca (`--color-primary`, `#037599`) é o Aguardando embarque, e o verde da marca, escurecido para ter contraste, é o Entregue. As outras quatro cores são tons próximos dos da marca (magenta, ocre, coral e violeta), com o mesmo peso visual, para que nenhuma fatia pareça mais importante pela cor.

| Token | Uso | Claro | Escuro |
|---|---|---|---|
| `--color-chart-status-1` | A distribuir | `#b0457f` | `#c0609a` |
| `--color-chart-status-2` | Aguardando produção | `#b97400` | `#bb8524` |
| `--color-chart-status-3` | Aguardando embarque | `#037599` | `#2f96c2` |
| `--color-chart-status-4` | Aguardando chegada | `#d0603a` | `#d27650` |
| `--color-chart-status-5` | Desembaraço | `#7c5cc4` | `#8f76d2` |
| `--color-chart-status-6` | Entregue | `#5f8f12` | `#72a22a` |
| `--color-chart-on-time` | No prazo | `#1a9478` | `#2ea88a` |
| `--color-chart-on-limit` | No limite | `#a87300` | `#b8841a` |
| `--color-chart-late` | Atrasado | `#b02a3a` | `#d0384f` |
| `--color-chart-no-data` | Sem dados | `#4f5d65` | `#b4c1c8` |

Como as cores foram conferidas (validador de paletas da skill `dataviz`, simulação de daltonismo de Machado et al., 2009; superfície `#ffffff` no claro e `#1b2a34` no escuro):

- **Status:** a ordem acima foi escolhida entre as permutações para que todas as fatias vizinhas, inclusive Entregue ao lado de A distribuir no fechamento do círculo, passem em todos os testes nos dois temas:
  - contraste ≥ 3:1 com a superfície (WCAG 1.4.11);
  - diferença ≥ 15 para visão normal (pior par: 19,4);
  - diferença ≥ 8 com protanopia e deuteranopia simuladas (pior par: 13,3).

  Não reordene as cores.
- **Prazo:** testadas todas contra todas, porque há só quatro. Verde, ocre e vermelho passam em tudo nos dois temas. O verde puxa para o verde-azulado para não se confundir com o vermelho no daltonismo vermelho-verde, e é diferente do verde de Entregue, do outro gráfico.
- **Sem dados:** é um cinza de propósito, mais escuro no tema claro e mais claro no escuro, para se separar das outras três pela luminosidade. No tema claro, o par cinza × vermelho fica em 7,6 na simulação de protanopia, abaixo do alvo de 8. Por isso a legenda com o nome de cada situação e o contorno de 2 px entre as fatias (R4) são obrigatórios.
- Quando uma fatia é zero, as vizinhas mudam (por exemplo, Aguardando produção ao lado de Aguardando chegada). A legenda e os rótulos continuam identificando cada fatia.

Defina os valores escuros nos mesmos blocos de tema escuro em que os outros tokens são redefinidos.

**R7. Textos** (`apps/web/lib/i18n/{pt-BR,en,zh-CN}.ts`), em `e2eLines.overview`:

| Chave | pt-BR | en | zh-CN |
|---|---|---|---|
| `label` | Resumo da carteira | Portfolio overview | 订单概览 |
| `statusTitle` | Quantidade de itens por status | Item quantity by status | 按状态统计的物料数量 |
| `deadlineTitle` | Quantidade por situação do prazo | Quantity by deadline status | 按期限状态统计的数量 |
| `onTime` | No prazo | In time | 准时 |
| `onLimit` | No limite | On limit | 临界 |
| `late` | Atrasado | Late | 延迟 |
| `noData` | Sem dados | No data | 无数据 |
| `empty` | Nenhum item para os filtros | No items for these filters | 没有符合筛选条件的物料 |
| `loading` | Carregando o resumo… | Loading the overview… | 正在加载概览… |
| `filterByStatus(status)` | Filtrar a tabela por {status} | Filter the table by {status} | 按{status}筛选表格 |
| `chartLabel(title, total)` | {title}: {total} itens no total | {title}: {total} items in total | {title}：共 {total} 件 |
| `sliceTitle(quantity, lines)` | {quantity} itens em {lines} linhas | {quantity} items in {lines} lines | {lines} 行共 {quantity} 件 |

Os nomes dos status reaproveitam `m.statuses` via `statusLabel`.

### Restrições
- Sem dependência nova (nada de biblioteca de gráficos).
- Sem migration e sem mudança nas Metas, na exportação, nos filtros da tabela ou nas contagens dos cards.
- A rota `e2e-stages` continua aceitando só os filtros de hoje (`stage`, `view` e `late` seguem recusados com 400).
- Não alterar testes existentes, exceto **acrescentar** asserções novas a eles.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| A1 | `e2eDeadlineStatus`: `null` (sem E2E) e `totalDelayDays: null` = `noData`; `1` = `late`; `0` = `onLimit`; `-1` = `onTime` | novo, `apps/api/test/followup-calculations.test.mjs` |
| A2 | `GET …/e2e-stages` devolve `overview` com as 6 chaves de status e as 4 de prazo, na ordem da R1; cancelados ficam de fora; a soma das `lines` de cada grupo é `totalCount`; as quantidades do fixture conferem, incluindo decimais (por exemplo `0.1` + `0.2` = `"0.3"`) e o zero (`"0"`); `totalCount`, `delivered` e `stages` iguais aos de hoje | acrescentado ao teste do resumo em `apps/api/test/shipment-lines.test.mjs` |
| A3 | `pieSlices`: frações somam 1; 1 fatia = círculo completo; total 0 = nenhuma fatia; valor zero sem caminho; fatia < 2% sem rótulo externo; ordem e sentido horário a partir das 12 h | novo, `apps/web/test/pie-chart.test.mjs` |
| A4 | `E2eLinesView` renderiza `E2eOverviewCharts` antes de `E2eModelSummary` e só quando `counts?.overview` existe; o clique de status passa por `applyFilters` com `status` | acrescentado a `apps/web/test/e2e-lines-view.test.mjs` |
| A5 | Os 10 tokens de gráfico existem nos dois temas com os valores da R6 e têm contraste ≥ 3:1 com `--color-surface`; as classes novas têm regra, e nenhuma regra fica sem uso | acrescentado a `apps/web/test/layout-consistency.test.mjs` (pares novos na lista de contraste, com mínimo 3) |
| A6 | Chaves de `e2eLines.overview` nos três dicionários; nenhum texto em português solto no componente | `i18n.test.mjs`, `i18n-coverage.test.mjs` e type-check (existentes) |
| A7 | Testes, lint, type-check e build passam em `apps/web` e `apps/api` | existentes |
| A8 | API HML no release novo: `/health/live` 200 e `e2e-stages` sem sessão 401. Conferência somente leitura no `erp_po_totvs_hml`, com as funções do release: soma das `lines` de cada grupo = `totalCount`; `byStatus.ENTREGUE.lines` = `delivered`; soma das quantidades de `byStatus` = soma das de `byDeadline` | manual, registrado neste arquivo |
| A9 | No Preview: os dois gráficos aparecem com os filtros padrão; ao mudar um filtro, os gráficos mudam; clicar numa fatia de status filtra a tabela e atualiza o campo Status; leitura correta em 1440, 1100, 760 e 480 px, nos temas claro e escuro e nos 3 idiomas | manual |

### Fora do escopo
- Filtrar a tabela pela situação do prazo. Exige um parâmetro novo em `GET /purchase-order-lines` e na exportação; pode ser a próxima entrega.
- Contar linhas em vez de somar quantidade.
- Gráficos na Análise por PO ou na Carteira.
- Converter unidades para somar quantidades de unidades diferentes.

## 5. Etapas (um commit por etapa, na `homologacao`)

1. **Conferência dos dados no HML (somente leitura)** — confirmar `current_database() = 'erp_po_totvs_hml'`. Contar as linhas e somar as quantidades abertas por status e por unidade (`item.unit`), e contar quantas linhas têm `totalDelayDays` nulo (pelas funções da API, sem gravar). Registrar os números na seção 7.
2. **Testes da API** — A1 e A2. Rodar `pnpm test` em `apps/api` e confirmar que só os novos falham.
   Commit: `test(api): e2e overview quantities by status and deadline`.
3. **API** — R1 e R2.
   Commit: `feat(api): e2e summary quantities by status and deadline`.
4. **Testes do web** — A3, A4 e A5, que devem falhar.
   Commit: `test(web): e2e overview pie charts`.
5. **Web** — R3 a R7: `lib/pie-chart.ts`, tokens, i18n, componente, CSS e integração.
   Commit: `feat(web): item quantity pie charts on the End to End`.
6. **Verificação completa** nos dois pacotes, até tudo passar. Descartar a alteração do build em `next-env.d.ts`.
7. **Release da API HML** — seguir o padrão de `deploy/hostinger/README.md`: `git -c core.autocrlf=false archive` do commit, release `hml-release-<sha>` com o `node_modules` do release anterior, drop-in novo, `daemon-reload`, reinício de `import-erp-hml-api` e worker com `enable-homologation-export-worker.sh <sha>`. Validar A8 e registrar no README o release, o backup dos drop-ins e o rollback. Publique a API antes do web; como o campo é aditivo, a ordem inversa também funciona, mas sem gráficos até a API subir.
8. **Publicação do web** — `git push production homologacao`; acompanhar com `npx --yes vercel@50.1.6 ls erp-comex --environment preview` até `Ready`.
9. **Validação no Preview** (`https://erp-comex-git-homologacao-eletra-comex.vercel.app/end-to-end`) — A9, com login.
10. **Registro** — atualizar o status no topo e a seção 7.

## 6. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/api/src/followup-calculations.ts` | `e2eDeadlineStatus` |
| `apps/api/src/shipment-lines.ts` | `overview` em `summarizeE2eStages` |
| `apps/api/test/followup-calculations.test.mjs`, `shipment-lines.test.mjs` | asserções novas |
| `apps/web/lib/pie-chart.ts` | novo |
| `apps/web/components/E2eOverviewCharts.tsx` | novo |
| `apps/web/components/E2eLinesView.tsx` | `overview?` no tipo, gráficos e filtro por status |
| `apps/web/app/styles/tokens.css` | 10 tokens de gráfico nos dois temas |
| `apps/web/app/styles/features/e2e.css` | `.e2e-overview` e partes do gráfico |
| `apps/web/lib/i18n/{pt-BR,en,zh-CN}.ts` | `e2eLines.overview` |
| `apps/web/test/pie-chart.test.mjs` | novo |
| `apps/web/test/e2e-lines-view.test.mjs`, `layout-consistency.test.mjs` | asserções novas |
| `deploy/hostinger/README.md` | registro do release HML |

## 7. Riscos e cuidados

- **Muitas linhas em "Sem dados":** `totalDelayDays` só existe quando todas as etapas têm meta e dias reais ou previstos. O saldo sem IP e as linhas sem modal (T4 sem meta) tendem a cair em "Sem dados". É o mesmo comportamento da fórmula do Power BI; a etapa 1 mede o tamanho dessa fatia.
- **"Atrasado" difere de "Só atrasados":** o gráfico usa o atraso total, e o botão usa o prazo da etapa atual. Uma linha pode estar atrasada na etapa atual e ainda ter atraso total nulo, ou o contrário.
- **Soma de unidades diferentes:** somar PC com KG dá um número sem significado físico. O Power BI faz o mesmo, e a decisão foi manter. A etapa 1 mede o quanto isso pesa no HML.
- **Leitura da pizza:** com uma fatia dominante (78% entregue no print), as fatias pequenas ficam ilegíveis. A legenda com valores é a leitura confiável, e o rótulo externo some abaixo de 2%.
- **Desempenho:** o resumo já calcula todas as linhas; os totais acrescentam uma passada O(n). Sem impacto esperado no volume atual (225 linhas no HML).
- **API e web publicados separadamente:** `overview` opcional no web (R5) evita quebra em qualquer ordem de deploy.
- **Produção:** nada deste plano toca `import-erp-api`, `main` ou as variáveis da Vercel. A promoção para `main` acontece por PR depois da aprovação.

### Registro da execução (2026-10-27)

- Conferência inicial somente leitura no `erp_po_totvs_hml`, com as funções do release anterior: 225 linhas no fluxo, nenhuma cancelada, nenhuma com `totalDelayDays` nulo e todas com unidade `UN`. Por status: 111 aguardando chegada (`14.025.245`), 33 aguardando produção (`4.558.900`), 35 aguardando embarque (`9.392.556`), 24 em desembaraço (`616.931`) e 22 entregues (`633.831`).
- Commits: `c2fe6b0` (testes API), `b938588` (API), `2cf37a8` (testes web) e `4362a3c` (web).
- Verificação local: toda a suíte e o build da API passaram; no web, 187 testes e o build passaram. O lint terminou sem erros e manteve 40 avisos preexistentes fora deste escopo.
- API e worker HML ativos no release `/opt/import-erp/apps/api/hml-release-4362a3c`. O health respondeu `200` e `e2e-stages` sem sessão respondeu `401`. Backup pré-deploy: `/var/backups/import-erp/hml-e2e-overview-4362a3c-predeploy`.
- A8 executado com `import_erp_hml_app`, `default_transaction_read_only=on` e banco confirmado como `erp_po_totvs_hml`: `totalCount = 225`, `delivered = 22`; a soma das linhas dos dois grupos é 225, `byStatus.ENTREGUE.lines = 22` e as quantidades dos dois grupos somam `29.227.463`. Nesta fotografia, todas as 225 linhas ficaram em `late`; `onTime`, `onLimit` e `noData` ficaram zerados.
- Preview do commit `4362a3c`: deployment `dpl_Hf26dWD2MHF2Hpitqjs1WKoJdcUF`, status `Ready`, alias `https://erp-comex-git-homologacao-eletra-comex.vercel.app`. A página `/login` foi lida pelo bypass da Vercel e mostrou o TMS em pt-BR com os três idiomas. O commit final de documentação `1c9aad8` gerou o deployment `dpl_ByUeqqS1qkZdJKvrvuJdvqC3BcAg`, também `Ready` no mesmo alias.
- A9 visual autenticado permanece pendente: este ambiente não tem uma sessão da aplicação, e as credenciais técnicas documentadas estão inválidas ou exigem troca de senha. Nenhuma senha foi alterada e nenhuma tentativa de login foi feita para evitar bloqueio de conta. Devem ser conferidos com uma conta válida o clique no status, os filtros, os temas, os idiomas e as larguras de 1440, 1100, 760 e 480 px.
