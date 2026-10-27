# Plano de implementação — Escolha de colunas nas exportações Excel

| Item | Valor |
|---|---|
| Data | 2026-10-27 |
| Branch de trabalho | `homologacao` (base: `5f2d4af`) |
| Ambiente de validação | API e worker HML na VPS (`import-erp-hml-api`, `import-erp-hml-export-worker`) e Preview Vercel da `homologacao` |
| Status | **Decisões fechadas em 2026-10-27; implementação em andamento** |

## 1. Resumo

Hoje toda exportação Excel sai com um conjunto fixo de colunas, e as telas Carteira por produto e End to End exportam as mesmas 92 colunas, a maioria fora da tabela que a pessoa está vendo. Com este plano, cada tela exporta **somente as colunas da sua tabela, na ordem da tabela**, e a pessoa escolhe, antes de exportar, quais delas entram no arquivo. Os filtros da tela continuam valendo, algumas colunas de identificação são obrigatórias e a escolha fica salva por tela no navegador.

Um pedido sem escolha de colunas (cliente antigo ou tarefa que já estava na fila durante a troca) continua saindo no layout de hoje.

## 2. Mapeamento das exportações

### 2.1 Modos de exportação

Todas passam pela fila `jobs.export_job`: a tela cria a tarefa, o worker gera o `.xlsx` e a tela baixa o arquivo, que fica disponível por 24 horas. Limite de 5.000 linhas e de 3 tarefas em andamento por pessoa.

| # | Tela | Botão (pt-BR) | Rota | `job_type` | Gerador (API) | Filtros enviados | Colunas hoje |
|---|---|---|---|---|---|---|---|
| E1 | Carteira de POs (`/`, `apps/web/app/page.tsx:139`) | "Exportar carteira filtrada (Excel)" | `POST /api/v1/exports/purchase-orders` | `purchase-order-xlsx` | `purchaseOrderExportXlsx` (`apps/api/src/purchase-order-exports.ts:111`) | `number`, `importer`, `product`, `ipNumber` (`filtersSchema`, `export-jobs.ts:8`). **O filtro de ciclo (`lifecycle`) da tela não é enviado** (ver D9). | 8 fixas |
| E2 | Carteira por produto (`/purchase-orders/lines`, `ProductLinesView.tsx:44`) | "Exportar linhas filtradas (Excel)" | `POST /api/v1/exports/purchase-order-lines` | `purchase-order-lines-xlsx` | `purchaseOrderLinesXlsx` (`purchase-order-exports.ts:200`) | `productLineFilterBody(filters)`: PO, importador, produto, IP, status, ETA, situação | 92 fixas |
| E3 | End to End (`/end-to-end`, `E2eLinesView.tsx:81`) | "Exportar Excel com o End to End" | a mesma de E2 | `purchase-order-lines-xlsx` | o mesmo de E2 | os de E2 mais etapa, visão, atraso, prazo, faixa de atraso, tipo de demanda e modal | as mesmas 92 de E2 |

E2 e E3 compartilham o hook `useProductLineExport` (`apps/web/components/useProductLineExport.ts`). E1 tem a própria cópia do fluxo em `page.tsx` e mostra o histórico das 5 últimas exportações, com o link "Baixar Excel" que baixa de novo o arquivo já gerado.

**Não são exportações:** `apps/web/lib/totvs-po-xlsx.ts` e `apps/web/lib/china-invoice-xlsx.ts` leem planilhas enviadas. O worker ainda aceita o tipo legado `purchase-order-csv` (`worker.ts:118`), que nenhuma rota cria. Os dois ficam como estão.

### 2.2 Colunas de cada tela (catálogo novo)

O catálogo de cada modo é a tabela da tela, na mesma ordem. Coluna de ação (botão "Abrir") não entra. "Obrig." indica as colunas obrigatórias (D2).

**E1 — Carteira de POs** (tabela em `page.tsx:261`; 7 colunas)

| # | Chave | Coluna na tela | Valor no arquivo | Obrig. |
|---|---|---|---|---|
| 1 | `poNumber` | PO TOTVS | `po.external_number` | sim |
| 2 | `importer` | Importador | `po.importer` | |
| 3 | `lifecycleStatus` | Status | rótulo em português do ciclo (Ativa, Encerrada, Cancelada, Excluída) — **novo no arquivo** | |
| 4 | `itemCount` | Itens | contagem de itens (a mesma de `operational_item_count` da tela) | |
| 5 | `linkedProcessCount` | IPs | IPs vinculados no escopo | |
| 6 | `itemsWithoutIp` | Itens sem IP | | |
| 7 | `unresolvedIssueCount` | Pendências | | |

Deixam de sair: `ID` (UUID interno) e `Itens com IP`, que não estão na tabela.

**E2 — Carteira por produto** (tabela em `ProductLinesView.tsx:105`; 15 colunas)

| # | Chave | Coluna na tela | Valor no arquivo | Obrig. |
|---|---|---|---|---|
| 1 | `poNumber` | PO | número da PO | sim |
| 2 | `importer` | Importador | | |
| 3 | `product` | Produto | **duas colunas no arquivo**: código e descrição (na tela ficam na mesma célula) | sim |
| 4 | `quantity` | Quantidade | número (a unidade não entra na célula) | |
| 5 | `ipNumber` | IP | vazio quando a linha não tem IP | |
| 6 | `status` | Status | valor da API em português | |
| 7 | `etd` | ETD | | |
| 8 | `departure` | Saída | `actualPortDepartureDate` | |
| 9 | `blDate` | Data do BL | | |
| 10 | `eta` | ETA | | |
| 11 | `arrival` | Chegada | | |
| 12 | `ete` | ETE | | |
| 13 | `delivery` | Entrega | | |
| 14 | `factoryShip` | Embarque na fábrica | | |
| 15 | `invoice` | Invoice | números separados por vírgula | |

**E3 — End to End** (tabela em `E2eLinesView.tsx:296`; 47 colunas, mais 1 condicional)

| # | Chave | Coluna na tela | Valor no arquivo | Obrig. |
|---|---|---|---|---|
| 1 | `necessity` | Necessidade | | |
| 2 | `poNumber` | PO | | sim |
| 3 | `scNumber` | SC | | |
| 4 | `ipNumber` | IP | | |
| 5 | `status` | Status | | |
| 6 | `purpose` | Finalidade | | |
| 7 | `productCode` | Produto | | sim |
| 8 | `description` | Descrição | | |
| 9 | `modal` | Modal | Aéreo/Marítimo pela mesma regra de `modalLabel` (`air`, senão `transportMode`) — **novo no arquivo** | |
| 10 | `group` | Grupo | `item_group` — **novo no arquivo** | |
| 11 | `quantity` | Quantidade | | |
| — | `accumulatedDelay` | Atraso acumulado até Tx | **só existe quando a tela está na visão "atingiu" com uma etapa selecionada**, igual à tabela; usa `accumulatedDelayDays` da etapa — **novo no arquivo** | |
| 12–41 | `t0Deadline` … `t5Delay` | T0 a T5 × Prazo, Real, Meta, Dias, Atraso | datas previstas em itálico cinza, como na tela (`is-forecast`) | |
| 42–44 | `totalTarget`, `totalActual`, `totalDelay` | Totais: Meta, Real, Atraso | | |
| 45 | `bottleneck` | Gargalo | | |
| 46 | `currentStatus` | Status atual | | |
| 47 | `arrivalMonth` | Chegada BR | | |

Na tela de escolha, as 30 colunas das etapas aparecem numa grade de 6 etapas × 5 medidas, com marcação por linha (etapa) e por coluna (medida).

## 3. Decisões

| # | Decisão | Situação |
|---|---|---|
| D1 | Ordem do arquivo **fixa, igual à da tabela da tela**. Cada tela oferece **só as colunas da sua tabela** (seção 2.2), para não sobrecarregar a escolha. | fechada (2026-10-27) |
| D2 | Obrigatórias: E1 `PO TOTVS`; E2 `PO` e `Produto`; E3 `PO` e `Produto`. | fechada |
| D3 | Seleção inicial e "Restaurar padrão": **todas as colunas da tela**. | fechada |
| D4 | Atalhos: "Marcar todas", "Desmarcar todas" e "Restaurar padrão" nas três telas, e a marcação por grupo. Os atalhos "Pré Embarque" e "Resumo End to End" da primeira versão deixam de fazer sentido com o catálogo reduzido e saem. | fechada; ajustada por D1 |
| D5 | E2 não oferece mais as colunas do End to End: elas não estão na tabela dela. | substituída por D1 |
| D6 | A tela de escolha mostra os nomes das colunas **no idioma selecionado na interface**, com os mesmos textos da tabela. | fechada |
| D7 | A escolha fica salva **no navegador, por tela**. | fechada |
| D8 | **Idioma dos cabeçalhos no arquivo:** o mesmo idioma da interface no momento da exportação, com os mesmos textos da tabela. O web envia, para cada coluna, a chave e o cabeçalho; a API valida a chave e o tamanho do texto e grava o cabeçalho como texto (nunca fórmula). Assim a tradução fica num lugar só, os dicionários do web. Os **valores** continuam como hoje (status e datas como a API devolve). | fechada (2026-10-27) |
| D9 | **Filtro de ciclo na exportação de E1.** Hoje a tela filtra por ciclo (ativas, encerradas, excluídas…), mas a exportação ignora esse filtro e sai sempre sem as excluídas. Como o arquivo passa a ter a coluna Status, a exportação passa a enviar `lifecycle` e aplicar o mesmo filtro da listagem (`portfolioWhere`, `purchase-orders.ts:28`). | fechada (2026-10-27) |
| D10 | **A exportação acompanha a tabela.** Quando uma coluna de dado for acrescentada, removida, renomeada ou mudada de posição na tabela de uma tela com exportação, o catálogo daquele contexto muda no mesmo commit (seção 3.1). | fechada (2026-10-27) |

### 3.1 Regra de evolução das colunas (D10)

O catálogo de cada contexto é a tabela da sua tela, e não uma lista independente. Por isso:

1. **Coluna nova na tabela** entra no catálogo da API e no espelho do web, na mesma posição, no mesmo commit. Ela aparece na janela de escolha com o mesmo rótulo da tabela, nos três idiomas.
2. **Coluna removida da tabela** sai do catálogo. Escolhas salvas no navegador com essa chave são limpas sozinhas ao abrir a janela (requisito 12).
3. **Coluna renomeada ou reordenada** segue a tabela. A chave (`key`) não muda quando só o rótulo muda; mude a chave só se o dado for outro.
4. **Quem salvou "todas"** recebe a coluna nova marcada. Quem salvou uma escolha parcial recebe a coluna nova desmarcada e a vê na janela.
5. **Coluna que só aparece em certo estado da tela** (como "Atraso acumulado até Tx") entra como condicional, com a mesma condição da tabela.
6. **Obrigatoriedade** de uma coluna nova é decidida com o usuário na tarefa que a cria; o padrão é opcional.
7. **Não entram:** colunas de ação (botões e links sem dado próprio) e valores que a tela não mostra.
8. **Tela nova com exportação** segue o mesmo modelo: catálogo próprio de contexto, igual à tabela da tela.
9. **Se o valor não estiver na API** (por exemplo, um campo calculado só no web), a tarefa da coluna nova inclui levar esse valor para `ShipmentLine` ou para a consulta de E1. A coluna não fica fora do arquivo por esse motivo.

O teste A8 garante a regra: ele falha quando a tabela de uma tela tem uma coluna de dado que não está no catálogo do contexto, ou vice-versa, ou quando a ordem diverge. A regra também está registrada no `AGENTS.md` (Parte 2, "Exportações Excel"), para valer em qualquer tarefa futura que mexa nessas tabelas.

## 4. Especificação

### Objetivo

Cada exportação Excel passa a conter só as colunas da tabela da sua tela, na ordem dela, e a pessoa escolhe quais dessas colunas entram no arquivo. Filtros, escopo por importador e limites da fila não mudam.

### Requisitos

**API e worker**

1. Novo módulo `apps/api/src/export-columns.ts` com três catálogos, um por contexto (`portfolio`, `product-lines`, `end-to-end`), na ordem da seção 2.2. Cada coluna tem `key`, `header` padrão em português, `width`, `required`, `value` e, quando aplicável, a condição de disponibilidade (`accumulatedDelay` exige `view=reached` e `stage`). O layout atual (8 e 92 colunas) continua no módulo como `legacy`, usado só quando o pedido não traz colunas.
2. Função pura `resolveExportColumns(context, columns?, filters)`:
   - `columns` ausente: layout `legacy` do tipo de tarefa (comportamento de hoje).
   - `columns` presente: remove chaves repetidas, acrescenta as obrigatórias com o cabeçalho padrão, descarta colunas condicionais indisponíveis para os filtros e devolve na ordem do catálogo (D1).
   - Chave fora do catálogo do contexto: erro.
3. As rotas `POST /api/v1/exports/*` aceitam:
   - `context`: `portfolio` na rota de POs; `product-lines` ou `end-to-end` na rota de linhas.
   - `columns`: 1 a N itens `{ key, header }`, sendo N o tamanho do catálogo. `header` tem de 1 a 80 caracteres, sem caracteres de controle (D8).
   - na rota de POs, também `lifecycle`, com o mesmo enum da listagem (D9).
   Se `columns` vier sem `context`, se o contexto não for daquela rota, ou se houver chave desconhecida, lista vazia ou lista longa demais, a resposta é `400` com "Colunas inválidas para a exportação." Os filtros continuam com a validação atual. `context` e `columns` são gravados em `parameters`.
4. Os geradores recebem as colunas resolvidas: escrevem só elas, com o cabeçalho recebido, congelamento e negrito na primeira linha e `autoFilter` do tamanho certo. Em E1, o `autoFilter` deixa de ser fixo em `A1:H1`. Em E3, as datas de etapas com `source = "forecast"` saem em itálico cinza. Em E2, a coluna `product` gera duas colunas no arquivo (código e descrição); o cabeçalho da descrição vem com a chave `productDescription`.
5. `queryPurchaseOrderExport` passa a devolver `lifecycleStatus` e a aplicar `lifecycle` (D9). O catálogo de linhas passa a ler `item.group`, `e2e.air` e `stages[x].accumulatedDelayDays`, que já estão em `ShipmentLine`.
6. O worker separa `context` e `columns` dos filtros antes de validar os filtros, resolve as colunas e, se forem inválidas, encerra a tarefa sem nova tentativa com `INVALID_EXPORT_COLUMNS`.
7. Nome do arquivo, `content-type`, expiração, limites (5.000 linhas, 3 tarefas) e o controle de escopo e de acesso às tarefas não mudam.

**Web**

8. `apps/web/lib/export-columns.ts`, só com dados e funções puras, sem importar valores de outros módulos de `lib/`: catálogos dos três contextos (`key`, grupo, obrigatória, condição) espelhando a API; `initialSelection(context, saved, filters)`; `toggleColumn`; `toggleGroup`; `selectAll`/`clearAll`; e `columnsBody(context, selection, m)`, que monta `{ context, columns: [{ key, header }] }` com os cabeçalhos do idioma atual.
9. Os rótulos vêm dos dicionários, de preferência reaproveitando as chaves que a tabela já usa (`m.followup.product`, `m.e2eLines.necessity` e outras), para a tela e o arquivo terem o mesmo texto. O mapa `key → rótulo` fica numa função de `lib/` que recebe `m: Messages`.
10. Componente `ExportColumnsDialog` sobre o `ConfirmDialog` (`<dialog>` nativo):
    - Título "Escolher colunas da exportação" e uma linha dizendo que os filtros aplicados na tela continuam valendo.
    - Ações "Marcar todas", "Desmarcar todas" e "Restaurar padrão".
    - Colunas na ordem da tabela. Em E3, as 11 primeiras ficam em lista, as etapas na grade 6 × 5 e os totais em seguida. A coluna condicional só aparece quando está disponível.
    - Obrigatórias marcadas e desabilitadas, com a indicação "obrigatória".
    - Contador "12 de 15 colunas" e botão "Exportar Excel". Esc e "Cancelar" fecham sem exportar.
    - Layout em 480 px e no tema escuro, só com tokens.
11. Os três botões de exportação abrem o diálogo; a confirmação chama o fluxo atual com o corpo de `columnsBody`. `useProductLineExport` recebe o contexto; `page.tsx` envia também `lifecycle` (D9).
12. A seleção confirmada fica salva no `localStorage` (`erp-comex-export-columns:portfolio`, `:product-lines` e `:end-to-end`), com leitura e escrita em `try/catch`. Ao abrir, chaves que não existem mais são descartadas e as obrigatórias voltam marcadas. Se a escolha salva era "todas", colunas novas do catálogo entram marcadas. Sem armazenamento disponível, o diálogo abre no padrão.
13. Textos novos nos três dicionários (`pt-BR`, `en`, `zh-CN`).

### Restrições

- Nenhuma coluna fora da tabela da tela; nenhum valor monetário novo em E1.
- O catálogo da API define as chaves válidas; o espelho do web é conferido por teste (critério A6).
- `parameters` é `jsonb`: não há migration.
- Layout pelo `AGENTS.md`: classes novas com regra única em `components.css`, cores só por `var(--…)`, nada de `!important`.
- O web novo envia campos que a API atual recusa (`strict`). Publique API e worker HML antes do Preview.
- Preserve as alterações locais que não são desta tarefa (`apps/web/next-env.d.ts`, `FluxoE2E.css`, `FluxoE2E.jsx`, `docs/PLANO_CAMPOS_FORMULARIO.md`, `docs/PLANO_CICLO_VIDA_PO.md`, `eletra-logo.png`) e não as inclua nos commits.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| A1 | Sem `columns`, E1 e E2/E3 geram exatamente os cabeçalhos e valores de hoje. | `purchase-order-export.test.mjs` atual, sem alteração |
| A2 | Com `columns`, cada contexto gera só as colunas pedidas mais as obrigatórias, na ordem da tabela, com os cabeçalhos recebidos e `autoFilter` do tamanho certo. Em E2, `product` gera código e descrição. Em E3, `accumulatedDelay` só sai com `view=reached` e `stage`, e datas previstas saem em itálico. | `purchase-order-export.test.mjs`, casos novos por contexto |
| A3 | `resolveExportColumns` remove repetidas, acrescenta obrigatórias, ordena, descarta condicional indisponível e recusa chave desconhecida ou de outro contexto. | `export-columns.test.mjs` (API, novo) |
| A4 | As rotas gravam `context` e `columns` válidos em `parameters`. Recusam com 400 lista vazia, chave desconhecida, contexto de outra rota, `columns` sem `context`, cabeçalho vazio ou com mais de 80 caracteres e lista maior que o catálogo. Continuam aceitando o corpo antigo. | `export-jobs.test.mjs` |
| A5 | E1 com `lifecycle` exporta as mesmas POs que a listagem com o mesmo filtro, com a coluna Status. | `purchase-order-export.test.mjs` (SQL) e `export-worker-hml.integration.mjs` |
| A6 | Chaves, ordem e obrigatoriedade do espelho do web são iguais aos catálogos da API nos três contextos. | teste de contrato na API que lê `apps/web/lib/export-columns.ts` |
| A7 | As funções do web cobrem: sem escolha salva, chave removida, "todas" com coluna nova, obrigatória sempre marcada, grupo inteiro, condicional e cabeçalhos no idioma atual (pt-BR, en, zh-CN). | `export-columns.test.mjs` (web, novo) |
| A8 | Regra D10: cada catálogo do web tem as mesmas colunas de dado, na mesma ordem, que a tabela da sua tela. O teste lista os rótulos dos `<th>` de dado do JSX (sem a coluna de ação) e compara com os rótulos do catálogo. Ele falha se uma coluna for acrescentada ou removida só de um dos lados. | `product-lines-view.test.mjs`, `e2e-lines-view.test.mjs`, `export-download.test.mjs` (leitura do JSX, no estilo atual) |
| A9 | O worker HML gera os três contextos com as colunas da tarefa e falha com `INVALID_EXPORT_COLUMNS` quando elas são inválidas. | `export-worker-hml.integration.mjs` |
| A10 | Textos nos três idiomas, sem português solto em `app/` e `components/`; classes com regra e tokens nos dois temas. | `i18n-coverage.test.mjs`, `layout-consistency.test.mjs`, `tsc` |
| A11 | No Preview, com sessão, cada tela exporta um arquivo com as colunas escolhidas, na ordem da tabela e no idioma da interface, respeitando os filtros. | validação manual no domínio da `homologacao` |

### Fora do escopo

- Reordenar colunas e colunas fora da tabela da tela.
- Unidade junto da quantidade ou formatação de números como na tela.
- Escolha salva no servidor ou compartilhada entre pessoas.
- Mostrar no histórico de E1 quantas colunas cada arquivo tem.
- Unificar o fluxo de exportação de `page.tsx` com `useProductLineExport`.
- Remover o layout `legacy`. Isso pode ser feito depois que não houver mais tarefas antigas na fila nem clientes antigos.
- Importações de planilha e o tipo legado `purchase-order-csv`.

## 5. Etapas (um commit por etapa, na `homologacao`)

1. **Testes da API** (`test(api): ...`): A1 a A6 e os casos do `export-worker-hml.integration.mjs`.
2. **Catálogos e geradores** (`feat(api): ...`): `export-columns.ts`, `resolveExportColumns`, geradores com colunas resolvidas, itálico nas datas previstas e `lifecycleStatus`/`lifecycle` em E1.
3. **Rotas e worker** (`feat(api): ...`): `context`, `columns` e `lifecycle` nas rotas e no worker. Ciclo completo da API (`pnpm test`, `pnpm build`).
4. **Publicação da API e do worker em HML**: release com `git -c core.autocrlf=false archive`, drop-in novo da API e `enable-homologation-export-worker.sh <commit>`, com backup dos drop-ins antes da troca. Conferir `/health/live` = 200 e a rota sem sessão = 401. Rodar `test:export-worker:hml` com `MIGRATION_ENV=isolated` e o `DATABASE_URL` do HML (A5, A9). Registrar em `deploy/hostinger/README.md`, com rollback.
5. **Testes do web** (`test(web): ...`): A7, A8 e o espelho usado em A6.
6. **Catálogo, diálogo e telas** (`feat(web): ...`): `lib/export-columns.ts`, `ExportColumnsDialog`, os três botões, estilos e os três dicionários. Ciclo completo do web (`pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`; não commitar `next-env.d.ts`).
7. **Preview**: `git push production homologacao`, confirmar o deployment `Ready` da branch e do commit, e validar A11 no domínio estável.
8. **Documentação**: atualizar `docs/EXPORTACAO_CARTEIRA.md` (colunas por tela, obrigatórias, padrão e a regra D10) e o status deste plano. A regra D10 já está no `AGENTS.md`; revise o texto de lá se a implementação mudar nomes de arquivos ou de testes.

## 6. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/api/src/export-columns.ts` | novo: catálogos por contexto, layout `legacy`, `resolveExportColumns` |
| `apps/api/src/purchase-order-exports.ts` | geradores por colunas resolvidas; `lifecycleStatus` e `lifecycle` em E1 |
| `apps/api/src/export-jobs.ts` | `context`, `columns` e `lifecycle` nas rotas |
| `apps/api/src/worker.ts` | separa e resolve colunas; `INVALID_EXPORT_COLUMNS` |
| `apps/api/test/export-columns.test.mjs` | novo (A3, A6), incluído no script `test` |
| `apps/api/test/purchase-order-export.test.mjs`, `export-jobs.test.mjs`, `export-worker-hml.integration.mjs` | casos novos |
| `apps/web/lib/export-columns.ts` | novo: espelho dos catálogos, rótulos por `m`, funções puras |
| `apps/web/components/ExportColumnsDialog.tsx` | novo |
| `apps/web/components/useProductLineExport.ts`, `ProductLinesView.tsx`, `E2eLinesView.tsx`, `apps/web/app/page.tsx` | abrir o diálogo e enviar contexto, colunas e `lifecycle` |
| `apps/web/app/styles/components.css` | regras do diálogo, da lista e da grade |
| `apps/web/lib/i18n/pt-BR.ts`, `en.ts`, `zh-CN.ts` | textos novos |
| `apps/web/test/export-columns.test.mjs` | novo (A7) |
| `apps/web/test/export-download.test.mjs`, `product-lines-view.test.mjs`, `e2e-lines-view.test.mjs` | A8 |
| `docs/EXPORTACAO_CARTEIRA.md`, `deploy/hostinger/README.md` | documentação e registro do release |

## 7. Riscos e cuidados

- **Perda das colunas da Pré Embarque.** Quem usa hoje o arquivo de E2/E3 para substituir a aba Pré Embarque ou alimentar o Power BI deixa de receber as 92 colunas. Isso é consequência de D1; avise quem usa o arquivo antes de publicar em produção.
- **Tabela e catálogo divergindo.** Se alguém mudar a tabela de uma tela sem mudar o catálogo, o arquivo deixa de espelhar a tela, o que contraria D10. O teste A8 pega a divergência, e o `AGENTS.md` registra a regra. O teste lê o JSX: se a tabela passar a montar os cabeçalhos de outra forma, o teste precisa acompanhar.
- **Ordem de publicação.** Web novo com API antiga recebe 400. Worker antigo com API nova ignoraria `columns` nas linhas (o `safeParse` sem `strict` descarta o campo) e entregaria o layout antigo sem avisar. Publique API e worker juntos, antes do Preview, e confirme os dois no release novo.
- **Cabeçalhos enviados pelo cliente (D8).** São texto limitado, validado e gravado como string, então uma fórmula nunca é executada; o teste existente de `=cmd` cobre o tipo da célula. As chaves continuam validadas pela API.
- **Tarefas antigas na fila** não têm `columns` e saem no layout `legacy`, como hoje.
- **HML somente.** A validação do worker grava e apaga tarefas em `jobs.export_job` do `erp_po_totvs_hml`. Confira `current_database()` e o papel `import_erp_hml_app` antes. Nunca use o `erp_po_totvs_test`, que é produção.
