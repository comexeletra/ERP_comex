# Plano de implementação — Resumo compacto e filtro cruzado no End to End

| Item | Valor |
|---|---|
| Data | 2026-10-27 |
| Branch de trabalho | `homologacao` (base: `1c9aad8`) |
| Plano anterior | `docs/PLANO_E2E_GRAFICOS_RESUMO.md` (primeira entrega, commits `c2fe6b0`…`1c9aad8`) |
| Ambiente de validação | API e worker HML na VPS e Preview Vercel da `homologacao` |
| Status | **Implementado e publicado em HML; A12 (validação visual com login) pendente** |

## 1. Resumo

A primeira entrega pôs duas pizzas no topo de `/end-to-end`. Na validação, o usuário apontou quatro problemas:

1. **Ocupam espaço demais:** cada card tem cerca de 540 px de altura.
2. **Os valores do gráfico de status só aparecem depois de clicar numa categoria.** Além disso, ao clicar, o gráfico vira 100% da categoria clicada, porque o filtro de status também é aplicado ao próprio gráfico.
3. **Só o gráfico de status é clicável.**
4. **Visual de Excel:** rótulos externos com linha guia e pizza grande. O visual precisa seguir o da plataforma.

Esta entrega troca o gráfico de status por uma **barra de distribuição** e deixa o gráfico de prazo como **pizza compacta**, com a legenda ao lado. Os dois passam a usar **filtro cruzado**, como no Power BI: o gráfico clicado continua mostrando todas as categorias, com a escolhida destacada; o outro gráfico, os cards das etapas e a tabela passam a mostrar só aquela categoria; clicar de novo limpa a seleção.

A auditoria da primeira entrega achou três defeitos, e esta entrega os corrige:

- rótulos sobrepostos com os dados reais do HML (Desembaraço 2,1% e Entregue 2,2% caem no mesmo ponto);
- `0,000%` mostrado para categorias vazias;
- fatias focáveis pelo teclado dentro de um `role="img"`.

As decisões da primeira entrega continuam valendo:

- soma da quantidade de itens;
- status da linha como dimensão do primeiro gráfico;
- fórmula `in_time_late` sobre `totalDelayDays`;
- cancelados de fora;
- paleta e tokens `--color-chart-*`, sem mudança.

## 2. Contexto para quem vai implementar

### 2.1 Regras do projeto (leia o `AGENTS.md` inteiro antes)

- Trabalhe na `homologacao` e preserve as alterações locais alheias à tarefa: `apps/web/next-env.d.ts`, `FluxoE2E.css`, `FluxoE2E.jsx`, `docs/PLANO_CAMPOS_FORMULARIO.md`, `docs/PLANO_CICLO_VIDA_PO.md` e `eletra-logo.png`. Não as inclua nos commits.
- **Commite também** `docs/PLANO_E2E_GRAFICOS_RESUMO.md` (ficou sem commit na primeira entrega) e este arquivo.
- A mudança toca a API, o **worker de exportação** e o web. Publique a API e o worker HML **antes** do web: o web novo manda o parâmetro `deadline`, e a API antiga o recusa com 400 (validação `strict`).
- Texto nos três dicionários. Cores só por token. Classes com regra própria em `app/styles/features/e2e.css`, sem regra órfã.
- Consulte o banco HML (`erp_po_totvs_hml`) somente em leitura. Nunca o `erp_po_totvs_test`, que é produção.

### 2.2 Comandos

Neste ambiente, o `pnpm` pode não estar no `PATH` do Git Bash; os scripts por `npm` são equivalentes.

| Verificação | `apps/web` | `apps/api` |
|---|---|---|
| Testes | `npm test` | `npm run build && npm test` (os testes leem o `dist`) |
| Lint | `npm run lint` | — |
| Type-check | `npx tsc --noEmit` | `npm run build` |
| Build | `npm run build` (descarte a mudança em `next-env.d.ts`) | `npm run build` |

### 2.3 Onde está cada peça

| Peça | Onde |
|---|---|
| Classificação do prazo | `e2eDeadlineStatus` em `apps/api/src/followup-calculations.ts` |
| Resumo e totais | `summarizeE2eStages` e `queryE2eStageSummary` em `apps/api/src/shipment-lines.ts` |
| Filtro após o cálculo (etapa e atraso) | `matchesE2eStage` e `queryShipmentLines` em `shipment-lines.ts`; o caminho que calcula tudo antes de paginar só roda com `stage` ou `late` |
| Esquemas de filtro | `lineFilterQuery` (rota `e2e-stages`) e `shipmentLineQuery` (linhas, exportação em `export-jobs.ts:59` e worker em `worker.ts:110`) |
| Filtros do web | `apps/web/lib/purchase-order-lines.ts`. `ProductLineFilters` é **compartilhado** com a tela Linhas de produto; `E2eStageFilter` é só do End to End |
| Tela | `apps/web/components/E2eLinesView.tsx` |
| Gráficos atuais | `apps/web/components/E2eOverviewCharts.tsx` e `apps/web/lib/pie-chart.ts` |
| Padrão visual de indicador | `.e2e-kpi` e `.e2e-label` em `app/styles/features/e2e.css` |

## 3. Decisões (fechadas com o usuário em 2026-10-27)

| # | Decisão |
|---|---|
| D1 | Gráfico de status: **barra de distribuição** horizontal, 100% empilhada, com a legenda abaixo. |
| D2 | Gráfico de prazo: **pizza compacta** (círculo cheio, cerca de 120 px), com a legenda ao lado e **sem rótulos externos nem linhas guia**. |
| D3 | **Filtro cruzado** nos dois gráficos (seção 4.1). |
| D4 | Clicar na categoria já selecionada limpa a seleção daquele gráfico. |

## 4. Especificação

### 4.1 Regras do filtro cruzado

Há dois filtros vindos dos gráficos: `status` (o mesmo campo Status do formulário) e `deadline` (novo: `onTime`, `onLimit`, `late` ou `noData`).

| Parte da tela | Status aplicado? | Prazo aplicado? |
|---|---|---|
| Barra de status (`byStatus`) | **não** (mostra todas as categorias e destaca a escolhida) | sim |
| Pizza de prazo (`byDeadline`) | sim | **não** (mostra todas e destaca a escolhida) |
| Cards das etapas, `totalCount` e `delivered` | sim | sim |
| Tabela e exportação | sim | sim |

Todos os outros filtros (PO, importador, produto, IP, ETA e situação) valem para tudo, como hoje. A etapa, a visão e "Só atrasados" continuam valendo só para a tabela e a exportação, como hoje.

### 4.2 API

**R1. Filtro `deadline`**
- Acrescentar `deadline: z.enum(["onTime", "onLimit", "late", "noData"]).optional()` a `lineFilterQuery`. Assim ele vale para a rota `e2e-stages`, para `GET /purchase-order-lines`, para a exportação e para o worker, que herdam de `shipmentLineQuery`.
- `ShipmentLineFilters` ganha `deadline?: E2eDeadlineStatus`.
- Nova função `matchesDeadline(line, deadline)`: sem `deadline`, aceita; com `deadline`, exige linha não cancelada e `e2eDeadlineStatus(lineE2e(line)) === deadline`.
- Em `queryShipmentLines`, o caminho que calcula todas as linhas antes de paginar passa a rodar também quando há `deadline`, aplicando `matchesE2eStage` e `matchesDeadline`. Sem `stage`, `late` e `deadline`, o banco continua paginando, como hoje.
- `stage`, `view` e `late` continuam recusados na rota `e2e-stages`, com 400.

**R2. Resumo com filtro cruzado** (`queryE2eStageSummary` e `summarizeE2eStages`)
- Buscar as linhas com todos os filtros **menos o status**: chame `queryLineRows` com `{ ...filters, status: undefined }`. O status é aplicado depois, em memória, por `line.calculated.status`, que o teste de integração HML já garante ser igual ao do SQL.
- Com `flow` = linhas não canceladas:
  - `byStatus`: soma sobre `flow` filtrado só por `matchesDeadline`;
  - `byDeadline`: soma sobre `flow` filtrado só pelo status;
  - `totalCount`, `delivered` e `stages`: sobre `flow` filtrado pelos dois.
- Formato da resposta, ordem das chaves e soma exata em `BigInt` iguais aos da primeira entrega.
- Invariantes:
  - sem status nem prazo, as `lines` de `byStatus` e de `byDeadline` somam `totalCount`, como hoje;
  - com status, `byDeadline` soma as linhas daquele status;
  - com prazo, `byStatus` soma as linhas daquela situação.
- Caso de borda: com `status=CANCELADO`, `byDeadline`, `totalCount` e `stages` ficam zerados, e `byStatus` mostra a carteira (sem cancelados). Não trate de outro jeito.

### 4.3 Web — filtros e integração

**R3. Filtro de prazo no End to End** (`lib/purchase-order-lines.ts`)
- **Não** mexa em `ProductLineFilters`, que é compartilhado com Linhas de produto.
- `E2eStageFilter` ganha `deadline: "" | "onTime" | "onLimit" | "late" | "noData"`.
  - `emptyE2eStageFilter` com `deadline: ""`;
  - `parseE2eStageFilter` lê `deadline` da URL e descarta valores desconhecidos;
  - `e2eStageFilterBody` envia `deadline` quando preenchido.
  - Assim ele vai para a URL, para a tabela e para a exportação sem mudar `useProductLineExport`.
- Nova função `e2eSummaryQuery(filters, deadline)` que devolve os filtros do formulário mais o `deadline`, sem `stage`, `view` nem `late`. É a query de `e2e-stages`.

**R4. `E2eLinesView.tsx`**
- **Estado do prazo:** `deadline` entra no estado do filtro de etapa e no `stageKey`, para a página voltar a 1. `summaryQuery` passa a usar `e2eSummaryQuery(applied, deadline)`.
- **Clique em status:** com o status já aplicado, limpa (`status: ""`); senão, aplica. Usa `setDraft` e `applyFilters`, como hoje, e o select Status do formulário acompanha.
- **Clique em prazo:** com a mesma situação já selecionada, limpa; senão, seleciona. Atualiza a URL (`syncUrl`), volta a tabela à página 1 e recarrega o resumo e a tabela.
- **Botão "Limpar" do formulário:** também limpa o `deadline`.
- **Sem `overview` na resposta** (API antiga): os gráficos não aparecem, como hoje.

### 4.4 Web — visual

**R5. Layout dos cards** (`.e2e-overview`)
- **Proporção:** dois cards lado a lado, com `grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)`. A barra precisa de mais largura.
- **Larguras menores:** abaixo de 1100 px, uma coluna. Na largura de 1440 px, cada card fica com **no máximo cerca de 220 px de altura**.
- **Estilo do card:** o mesmo dos indicadores do Modelo (`.e2e-kpi`): superfície, borda, `--radius-lg`, `--shadow-sm` e padding `16px 20px`.
- **Cabeçalho do card:**
  - à esquerda, o título com o estilo de `.e2e-label` (caixa alta, pequeno, `--color-text-muted`);
  - abaixo do título, o total em destaque, como o `strong` do `.e2e-kpi`: `--fs-xl`, `--color-text-strong`, `tabular-nums`. Use o formato compacto mais `totalItems`, por exemplo `29,23 mi itens`;
  - à direita, quando há seleção naquele gráfico, um botão de texto `clearSelection` ("Limpar seleção").
- **Visual da plataforma, não de Excel:** sem `<h2>` grande, sem rótulos externos, sem linhas guia e sem bordas fora do padrão de card.

**R6. Barra de distribuição (status)**
- **A barra:** uma faixa de 14 px de altura, com `--radius-sm` nas pontas e segmentos na ordem do fluxo e nas cores `--color-chart-status-1..6`.
  - A largura de cada segmento é proporcional à quantidade. Um segmento diferente de zero tem no mínimo 3 px.
  - Entre segmentos, um espaço de 2 px na cor `--color-surface`.
  - Categoria zerada não gera segmento.
- **Legenda:** abaixo da barra, em grade de **2 colunas** (1 coluna abaixo de 480 px), com as 6 categorias na ordem do fluxo. Cada item mostra:
  - a cor (quadrado de 10 px);
  - o nome (`statusLabel`);
  - a quantidade compacta, alinhada à direita, em `--color-text-strong`;
  - o percentual, em `--color-text-muted`.
- **Itens clicáveis:** cada item da legenda é um `button`, com `aria-pressed` e `aria-label` = `filterByStatus(nome)`. É o caminho pelo teclado.
- **Segmentos:** os segmentos são `div` com `onClick` (atalho de mouse), `title` = `sliceTitle(...)` e `aria-hidden="true"`. **Não** são focáveis.
- **Selecionado:** com uma categoria selecionada, os outros segmentos e itens ficam com `opacity: .35` (classe `is-dimmed`), e o item escolhido fica com fundo `--color-surface-sunken`.
- **Contêiner:** a barra fica num contêiner com `role="img"` e `aria-label` = `chartLabel(título, total)`.

**R7. Pizza compacta (prazo)**
- **Disposição:** a pizza (`viewBox` 120×120, raio 56, contorno de 2 px na cor `--color-surface`) fica à esquerda, e a legenda à direita, em uma coluna com as 4 situações. Abaixo de 480 px, a legenda vai para baixo da pizza.
- **Geometria:** continua de `pieSlices`, que perde `label`, `guide`, `labelRadius` e `minimumLabelFraction`. Esses campos ficam sem uso, e código morto sai, junto com os testes deles.
- **Acessibilidade:** o `<svg>` tem `role="img"` e `<title>` (`chartLabel`) e **nenhum** filho focável. As fatias têm `onClick` (mouse) e `<title>` (`sliceTitle`).
- **Legenda:** igual à da barra (R6), com `button`, `aria-pressed` e `aria-label` = `filterByDeadline(nome)`, e o mesmo esmaecimento com `is-dimmed`.

**R8. Valores sempre visíveis e formatação**
- **Sempre visíveis:** os valores e os percentuais aparecem na legenda **sem nenhuma interação**. Antes de mudar o código, reproduza o sintoma 2 da seção 1 com os dados do HML (ou com o fixture do teste), anote a causa no registro (seção 7) e garanta que ela não existe no componente novo.
- **Quantidade:** use `Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 })` na legenda e no total. O valor completo fica no `title`, com `Intl.NumberFormat(locale, { maximumFractionDigits: 2 })`. **Não** use `formatNumber` aqui: ele fixa pt-BR e duas casas.
- **Percentual:**
  - categoria zerada mostra `—` na quantidade e no percentual;
  - de 0 a 1%, mostra até 2 casas (`0,02%`);
  - a partir de 1%, mostra 0 casas.
- **Quantidade total zero:** mostra `empty` no lugar da barra ou da pizza. A legenda continua, com `—`.

**R9. Textos** (`e2eLines.overview`, nos 3 dicionários)

| Chave | pt-BR | en | zh-CN |
|---|---|---|---|
| `totalItems(total)` | {total} itens | {total} items | 共 {total} 件 |
| `clearSelection` | Limpar seleção | Clear selection | 清除选择 |
| `filterByDeadline(label)` | Filtrar por {label} | Filter by {label} | 按{label}筛选 |

As chaves da primeira entrega continuam valendo. Chave que ficar sem uso sai dos três dicionários.

**R10. CSS** (`app/styles/features/e2e.css`)
- Remova as regras que ficarem sem uso: `.e2e-pie-guide`, `.e2e-pie-label`, `.e2e-pie-action` e o `h2` do card.
- Crie as regras novas da barra, da legenda em grade e de `is-dimmed`.
- Cada seletor continua com uma única regra própria por media query, e os breakpoints são 480, 760 e 1100 px.

### Restrições
- Sem dependência nova, sem migration e sem mudar a paleta, a fórmula do prazo ou a soma exata.
- Não alterar `ProductLineFilters` nem a tela Linhas de produto.
- Testes da primeira entrega que verificam o comportamento antigo de propósito (clique que só aplica, rótulos externos, `g` focável) **devem** ser atualizados para a regra nova; isso é mudança de especificação, não ajuste para passar. Os demais testes existentes não mudam.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| A1 | `GET /purchase-order-lines?deadline=late` devolve só linhas com atraso total positivo, paginando depois do cálculo; sem `stage`, `late` e `deadline`, o banco continua paginando; `deadline=foo` dá 400 | `apps/api/test/shipment-lines.test.mjs` (teste novo) |
| A2 | `e2e-stages` com `status=X`: `byStatus` igual ao da chamada sem status; `byDeadline`, `totalCount` e `stages` só com linhas de X. Com `deadline=Y`: `byDeadline` igual ao da chamada sem prazo; `byStatus`, `totalCount` e `stages` só com linhas de Y. Com os dois, cada gráfico ignora o próprio filtro | mesmo arquivo (teste novo) |
| A3 | A exportação e o worker aceitam `deadline` (contrato de `shipmentLineQuery.strict()`) e o worker filtra por ele | `export-jobs` e worker: teste novo ou acrescentado onde já são testados |
| A4 | `parseE2eStageFilter`, `e2eStageFilterBody` e `e2eSummaryQuery` leem, enviam e descartam `deadline` corretamente; `e2eSummaryQuery` nunca leva `stage`, `view` ou `late`; `ProductLineFilters` não muda | `apps/web/test/purchase-order-lines.test.mjs` |
| A5 | `pieSlices` sem `label` e `guide`; os testes de geometria (ordem, círculo completo, zeros) continuam | `apps/web/test/pie-chart.test.mjs` |
| A6 | Função pura de percentual e quantidade (em `lib/`, sem texto): zero dá `—`; 0,0002 dá `0,02%`; 0,48 dá `48%`; compacto por idioma | teste novo em `apps/web/test/` |
| A7 | `E2eLinesView`: o clique no status selecionado limpa; o clique em prazo grava `deadline` na URL e no filtro; "Limpar" zera `deadline`; o resumo usa `e2eSummaryQuery` | `apps/web/test/e2e-lines-view.test.mjs` |
| A8 | `E2eOverviewCharts`: nenhum elemento com `tabIndex` ou `role="button"` dentro de `role="img"`; os itens da legenda são `button` com `aria-pressed` nos dois gráficos; não usa `formatNumber` | mesmo arquivo ou teste novo de componente (estilo atual: leitura do fonte) |
| A9 | Regras CSS novas existem, as removidas não têm uso, e `.e2e-overview` usa `3fr`/`2fr` com uma coluna a 1100 px | `apps/web/test/layout-consistency.test.mjs` |
| A10 | Testes, lint, type-check e build passam em `apps/web` e `apps/api` | existentes |
| A11 | API e worker HML no release novo: `/health/live` 200; `e2e-stages` sem sessão 401. Conferência somente leitura no HML: com `deadline=late`, `byStatus` soma as linhas atrasadas; com `status=AGUARDANDO CHEGADA`, `byStatus` continua com as 6 categorias da carteira | manual, registrado na seção 7 |
| A12 | No Preview, com login: os cards têm no máximo cerca de 220 px de altura a 1440 px; os valores aparecem sem clicar; clicar em uma categoria de cada gráfico filtra o outro, os cards e a tabela, mantendo o gráfico clicado inteiro; clicar de novo limpa; a exportação respeita o prazo; leitura em 1440, 1100, 760 e 480 px, nos dois temas e nos 3 idiomas | manual |

### Fora do escopo
- Destacar na tabela a situação do prazo de cada linha (coluna nova).
- Filtro cruzado com a etapa selecionada nos cards.
- Mudanças na tela Linhas de produto.

## 5. Etapas (um commit por etapa, na `homologacao`)

1. **Plano** — commitar `docs/PLANO_E2E_GRAFICOS_RESUMO.md` e este arquivo.
   Commit: `docs: plan the compact e2e overview with cross-filtering`.
2. **Testes da API** — A1, A2 e A3, que devem falhar.
   Commit: `test(api): e2e deadline filter and cross-filtered summary`.
3. **API** — R1 e R2.
   Commit: `feat(api): filter e2e lines by deadline status and cross-filter the summary`.
4. **Testes do web** — A4 a A9, que devem falhar.
   Commit: `test(web): compact e2e overview with cross-filtering`.
5. **Web** — R3 a R10.
   Commit: `feat(web): distribution bar, compact pie and cross-filtering on the End to End`.
6. **Verificação completa** nos dois pacotes.
7. **Release da API e do worker HML** — mesmo procedimento da primeira entrega (`deploy/hostinger/README.md`, seção de 2026-10-27), novo `hml-release-<sha>` com o worker movido junto. Validar A11 e registrar no README.
8. **Web** — `git push production homologacao` e acompanhar até `Ready`.
9. **Validação no Preview** — A12, com login do usuário. Se não houver sessão, deixe pendente e não tente credenciais.
10. **Registro** — status no topo e seção 7.

## 6. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/api/src/shipment-lines.ts` | `deadline` no esquema e nos filtros; `matchesDeadline`; resumo com filtro cruzado |
| `apps/api/test/shipment-lines.test.mjs` | testes novos (A1 e A2) |
| `apps/api/test/` (exportação/worker) | A3 |
| `apps/web/lib/purchase-order-lines.ts` | `deadline` em `E2eStageFilter`; `e2eSummaryQuery` |
| `apps/web/lib/pie-chart.ts` | sem rótulos e guias |
| `apps/web/lib/<formatação do resumo>.ts` | novo: percentual e compacto (A6) |
| `apps/web/components/E2eOverviewCharts.tsx` | barra, pizza compacta, legenda clicável nos dois |
| `apps/web/components/E2eLinesView.tsx` | `deadline`, alternância de seleção e query do resumo |
| `apps/web/app/styles/features/e2e.css` | regras novas; saem as de rótulo, guia e ação |
| `apps/web/lib/i18n/{pt-BR,en,zh-CN}.ts` | chaves de R9; saem as sem uso |
| `apps/web/test/*.test.mjs` | A4 a A9 |
| `deploy/hostinger/README.md` | registro do release HML |

## 7. Riscos e registro

- **Ordem de deploy:** o web novo manda `deadline`, e a API antiga recusa com 400. Por isso a API e o worker vão primeiro (etapa 7).
- **Resumo sem o filtro de status no SQL:** a consulta passa a trazer as linhas de todos os status e a filtrar em memória. No volume atual (225 linhas no HML), o custo é desprezível; o resumo já calculava todas as linhas filtradas.
- **Prazo depois do cálculo:** com `deadline`, a tabela calcula todas as linhas antes de paginar, como já acontece com etapa e atraso.
- **Dados do HML:** na fotografia de 2026-10-27, as 225 linhas estavam em "Atrasado". A pizza de prazo vai aparecer como um círculo único até haver dados variados. Isso não é defeito, mas o usuário ainda vai comparar algumas linhas com o "Total DelayDays" do Power BI.

### Registro da execução (2026-10-27)

- **Commits:** `ac02964` (planos), `2d46710` (testes API), `3c65cce` (API), `63b98ef` (testes web) e `c8a9c6c` (web).
- **Sintoma 2 (valores só depois do clique):** não houve sessão autenticada para reproduzir na tela. No código da primeira entrega, duas causas explicam o que o print mostra:
  - o filtro de status era aplicado ao próprio gráfico, que ficava com uma fatia de 100% e as demais zeradas;
  - os rótulos ficavam fora da pizza, com sobreposição (Desembaraço e Entregue no mesmo ponto com os dados do HML).

  No componente novo, valores e percentuais ficam sempre na legenda, e o gráfico clicado mantém todas as categorias.
- **Verificação local:**
  - API: `npm run build` e `npm test`, sem falhas;
  - web: 195 testes passando, `tsc --noEmit` sem erros, lint com 0 erros (40 avisos antigos, nenhum nos arquivos alterados) e `npm run build` concluído. A alteração do build em `next-env.d.ts` foi descartada.
- **Teste que mudou nesta entrega:** o teste de `E2eLinesView` que eu tinha acabado de escrever fixava a linha do clique em status sem anotação de tipo. O type-check exigiu `const filters: ProductLineFilters`, e o teste passou a fixar a linha anotada. O comportamento verificado é o mesmo.
- **Conferência visual sem login:**
  - **Método:** o componente real foi renderizado com React no servidor, com os dados do HML e uma carteira variada, nos 3 idiomas e nos 2 temas. Com o CSS do app, o Chrome headless gerou capturas em 1440, 900 e 500 px.
  - **Resultado:** cada card ficou com cerca de 210 px de altura em 1440 px.
  - **Ajustes feitos depois das capturas:** a legenda de status passou a 1 coluna abaixo de 760 px, porque em 500 px os nomes ficavam cortados. A legenda da pizza ficou limitada a 420 px de largura.
- **A11:** aprovado; números no `deploy/hostinger/README.md`, seção de 2026-10-27. A pizza de prazo no HML continua com 100% "Atrasado".
- **Preview:** `erp-comex-700fh5j8o` (commit `c8a9c6c`) `Ready` no alias estável; `/login` respondeu `200`, e o CSS publicado contém as regras novas.
- **Posição (pedido do usuário depois da publicação):** os gráficos saíram do topo e ficaram logo acima do card de filtros da tabela de produtos, depois dos painéis do Modelo (régua, etapa ativa e marcos). Isso substitui a D5 da primeira entrega. O aviso de carregamento do resumo foi junto; o aviso de erro do resumo continua no topo, porque também vale para os cards das etapas.
- **Blocos recolhíveis (pedido do usuário):** "Resumo da carteira" (os dois gráficos) e "Filtros da tabela" têm um botão Ocultar/Mostrar (`E2eCollapsible`, com `aria-expanded` e `aria-controls`).
  - Fechado, o bloco mostra só o título, o botão e, se houver, um selo com quantos filtros continuam aplicados: seleções dos gráficos ou campos do formulário.
  - A escolha de cada pessoa fica no `localStorage` do navegador (`erp-comex-e2e-charts-collapsed` e `erp-comex-e2e-filters-collapsed`). Ela é lida com `useSyncExternalStore`, então a renderização do servidor sai aberta, sem divergência na hidratação. Com o armazenamento bloqueado, a escolha vale só para a página aberta.
  - O resumo continua sendo carregado com o bloco fechado, porque os cards das etapas dependem dele.
  - **Identificação (pedido do usuário):** cada bloco tem um ícone (gráfico ou funil) ao lado do título. Minimizado, o bloco dos gráficos vira uma faixa no formato de card com o ícone, o título, uma minibarra nas cores dos status (só ilustrativa, `aria-hidden`), o texto "2 gráficos ocultos · total em itens", o selo de filtros ativos e o botão "Mostrar".
- **Terceiro gráfico, "Quantidade por faixa de atraso" (pedido do usuário):**
  - **Regra:** a "Faixa de atraso total" do Power BI aplicada ao `totalDelayDays`. As faixas são adiantado (< 0), no prazo (0), até 30, 30 a 45, 45 a 60, 60 a 90, 90 a 120 e 120 dias ou mais, com os limites superiores inclusivos. "Sem dados" quando não há atraso total.
  - **Implementação:** `e2eDelayRange` e `E2E_DELAY_RANGES` em `followup-calculations.ts`; `overview.byDelayRange` e o filtro `delayRange` na API, na exportação e no worker.
  - **Ordem e faixas vazias:** decididas com o usuário, as barras vão da maior quantidade para a menor, como no Power BI. Faixas vazias, inclusive "Sem dados", não aparecem; a faixa selecionada continua visível.
  - **Visual:** segue a identidade da aplicação, não a do Power BI: linhas no formato das legendas, com medidor arredondado sobre trilho, quantidade e percentual. Usa o token `--color-chart-range` (azul da marca) e o cinza de "Sem dados".
  - **Filtro cruzado:** o clique numa faixa funciona como nos outros gráficos, e o gráfico de faixas ignora o próprio filtro.
  - **Layout:** a barra de status passou a ocupar a linha inteira, com a legenda em 3 colunas. A pizza de prazo e as faixas ficam lado a lado embaixo. A faixa minimizada diz "3 gráficos ocultos".
- **Produto, Modal, Visão e Só atrasados nos gráficos (pedido do usuário):** substitui a regra da seção 4.1 de que a etapa, a visão e "Só atrasados" valiam só para a tabela.
  - **Produto e Modal:** ganharam "Todos", que vem marcado ao abrir, e passaram a filtrar os gráficos, os cards das etapas, a tabela e a exportação. Os parâmetros são `demandType=mts|notMts` e `modal=sea|air`, que vão também para a URL. Com "Todos", o Modelo usa o cenário padrão (Não MTS e Marítimo). Linhas sem tipo de demanda ou sem modal só aparecem em "Todos".
  - **Etapa, Visão e Só atrasados:** os gráficos seguem a etapa selecionada, a visão e "Só atrasados", e mostram exatamente as linhas da tabela. Os cards das etapas continuam com a contagem de todas as etapas.
  - **Animação:** cada resumo carregado fica guardado enquanto os filtros não mudam, e o último resumo fica na tela enquanto o próximo carrega. Assim os gráficos acompanham a animação sem piscar.
  - **Teste antigo que mudou:** o teste que exigia `400` para `e2e-stages?stage=T3` passou a usar uma etapa inválida (`T9`), porque a rota agora aceita a etapa.
- **Pendente (A12):** conferência com login: clique nos dois gráficos, limpeza da seleção, exportação com prazo, larguras, temas e idiomas.
