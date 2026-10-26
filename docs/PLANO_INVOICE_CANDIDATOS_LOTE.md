# Plano de implementação — Candidatos da invoice em uma única consulta

| Item | Valor |
|---|---|
| Data | 2026-10-26 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | **Implementado e publicado em HML/Preview; upload da IPH034A pendente por arquivo ausente** |

## Sumário

1. [Resumo](#1-resumo)
2. [Diagnóstico](#2-diagnóstico)
3. [Especificação](#3-especificação)
4. [Etapas](#4-etapas)
5. [Deploy e validação](#5-deploy-e-validação)
6. [Arquivos afetados](#6-arquivos-afetados)
7. [Riscos e cuidados](#7-riscos-e-cuidados)
8. [Pendências fora deste plano](#8-pendências-fora-deste-plano)
9. [Resultado da execução](#9-resultado-da-execução)

---

## 1. Resumo

| | Problema | Solução |
|---|---|---|
| 1 | A invoice `IPH034A 2026 INV+PL.xlsx` (196 linhas, PO 030201) termina com "Falha na API (HTTP 500)" e "0 destinos" | A tela passa a buscar os candidatos de todas as POs da invoice em **uma** chamada |
| 2 | O bloqueio por excesso de chamadas aparece como erro genérico 500 | A API responde `429` com `Retry-After` e uma mensagem legível |

Não há migration nem gravação no banco. A rota `GET /api/v1/purchase-orders/invoice-candidates` atual continua existindo, porque a produção a usa até a promoção.

## 2. Diagnóstico

Evidências coletadas em 2026-10-26 no log de `import-erp-hml-api` e no código:

- **Uma chamada por par PO + produto.** Na carga da invoice ([NewOperationalRecord.tsx](../apps/web/components/NewOperationalRecord.tsx), cerca da linha 515) e no botão "Revalidar POs e saldos" (cerca da linha 585), a tela chama `GET /invoice-candidates` uma vez para cada par distinto PO + produto, em lotes de 8 em paralelo. A IPH034A gera cerca de 190 chamadas.
- **Limite global de 120 chamadas por minuto.** Ver [server.ts:66](../apps/api/src/server.ts#L66). O log registrou 19 respostas `Rate limit exceeded, retry in 43 seconds` durante a carga.
- **Qualquer erro vira 500.** O `setErrorHandler` ([server.ts:121-127](../apps/api/src/server.ts#L121-L127)) responde 500 para todo erro, inclusive o 429 do `@fastify/rate-limit`. O plugin já grava `Retry-After` na resposta antes de lançar um erro com `statusCode = 429`.
- **Uma falha descarta tudo.** O `Promise.all` de cada lote rejeita, e a tela abandona a carga inteira.
- **Trabalho redundante.** Cada chamada já devolve **todas** as linhas da PO, ordenadas com o produto pedido primeiro ([operations.ts:1471-1520](../apps/api/src/operations.ts#L1471-L1520)). Na IPH034A são cerca de 190 respostas com as mesmas 215 linhas da PO 030201, uns 41 mil registros. Basta buscar cada PO uma vez e ordenar por produto na tela.

Esperar e tentar de novo não resolve: a invoice continua precisando de mais de 120 chamadas.

## 3. Especificação

### Objetivo
Carregar os candidatos de todas as POs da invoice com uma chamada à API, seja qual for o número de linhas, e informar com clareza quando o limite de chamadas for atingido.

### Requisitos

1. **Nova rota** `POST /api/v1/purchase-orders/invoice-candidates/batch`, com permissão `purchase-orders.read`.
   - Entrada (zod `.strict()`): `{ importer, revisingIpNumber?, poNumbers: string[] }`, com 1 a 200 números. Duplicatas exatas são ignoradas.
   - Saída: `{ purchaseOrders: [{ sourcePoNumber, poExists, purchaseOrderId, poStatus, items }] }`, na ordem pedida. Os `items` têm os mesmos campos da rota GET, incluindo `remainingQuantity`, que desconsidera o IP em revisão.
   - Mesmas regras da rota GET: escopo da importadora (fora do escopo responde `404`, como `inScope` faz hoje); itens só de PO `ACTIVE`; itens com `source_status` cancelado excluídos; número da PO normalizado no SQL (`PO 030201` → `030201`); distinção entre PO não cadastrada (`poExists: false`) e PO encerrada ou excluída (`poStatus`).
   - Exatamente **duas consultas** de dados: os itens de todas as POs e a existência e o status de todas as POs, ambas com `unnest($n::text[])` numa CTE `requested(source, normalized)`. Quando houver mais de uma PO com o mesmo número, a consulta de existência prefere a `ACTIVE`.
2. **Função pura** `invoiceCandidatesForProduct(items, productCode)` em [china-invoice-mapping.ts](../apps/web/lib/china-invoice-mapping.ts): itens do mesmo produto primeiro (com a mesma comparação de `invoicePoCodeDiffers`) e depois por `lineNumber`, reproduzindo a ordenação que a API faz hoje.
3. **Tela:** os dois loops passam a usar uma função compartilhada `loadInvoiceCandidates(importer, ipNumber, poNumbers)`, que deduplica pelo número normalizado e faz uma única chamada à rota batch. A sugestão automática (`suggestInvoicePoItem`), os avisos e os bloqueios continuam iguais.
4. **Erro 429:** o tratamento de erros sai de `server.ts` para o módulo testável `api-error-response.ts`. Quando `statusCode === 429`, a API responde `429` com o `Retry-After` do plugin e um corpo no formato `problem` (`code: "RATE_LIMITED"`), com `detail` "Muitas consultas em pouco tempo. Tente novamente em N segundos.". Os demais erros continuam como `500 { error: "Erro inesperado." }`. A tela já mostra o `detail` ([api.ts:71](../apps/web/lib/api.ts#L71)). Por ser mensagem gerada pela API, ela fica em português e não entra nos dicionários de i18n.

### Restrições
- A rota GET atual e o limite de 120 por minuto não mudam.
- Sem migration, sem escrita e sem transação na rota batch: o pool de teste falha se `connect()` for chamado.
- Seguir os padrões existentes: `problem(...)`, `permissionConfig`, testes `node --test` com `app.inject` sobre `dist/`, e `lib/` sem imports de valores entre módulos.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Uma entrada por PO pedida, na ordem, deduplicada; PO ativa com itens, PO não cadastrada e PO encerrada com `poExists`, `purchaseOrderId` e `poStatus` corretos; itens sem o campo interno `sourcePoNumber` | `apps/api/test/operations.test.mjs` |
| 2 | Duas consultas de dados por chamada, com os parâmetros `[importer, poNumbers, revisingIpNumber, scopes]`, filtro `ACTIVE` e exclusão de cancelados | `operations.test.mjs` |
| 3 | Importadora fora do escopo → `404`; lista vazia, mais de 200 POs ou campo extra → `400`; nenhum caso consulta dados | `operations.test.mjs` |
| 4 | Rota registrada para a web | `apps/api/test/web-route-contract.test.mjs` |
| 5 | Rate limit estourado → `429`, `Retry-After` inteiro e positivo, `detail` com os segundos; outro erro → `500` genérico, sem vazar a mensagem | `apps/api/test/api-error-response.test.mjs` (novo, incluído no script `test`) |
| 6 | Ordenação dos candidatos por produto e depois por linha; a sugestão automática não muda | `apps/web/test/invoice-destination-status.test.mjs` ou um teste novo de mapeamento |
| 7 | O componente usa a rota batch na carga e na revalidação e não chama mais `invoice-candidates?` | teste estático em `apps/web/test/` |
| 8 | A IPH034A carrega no Preview com destinos maiores que zero e sem 500, e o log da API mostra uma chamada batch por carga | validação manual no HML |

### Fora do escopo
- Divergência de fornecedor (o Exporter da invoice inclui o endereço) e equivalência de unidades (PCS, PC, UN). Ver [seção 8](#8-pendências-fora-deste-plano).
- `trustProxy` (cota de chamadas por usuário).
- Remover a rota GET antiga, o que fica para depois da promoção à produção.
- Cadastrar no HML as POs ausentes (por exemplo, 030321) ou o item 2070700600 na 030201.

## 4. Etapas

Cada etapa termina com testes, lint, type-check e build passando e com um commit na `homologacao`.

| Etapa | Conteúdo | Verificação |
|---|---|---|
| 1 | Testes da API (critérios 1 a 5), que falham | em `apps/api`: `pnpm run build && pnpm test` falha só nos testes novos |
| 2 | `api-error-response.ts` + `server.ts` usando `registerApiErrorHandler`; rota batch em `operations.ts`; novo teste no script `test` | test e build da API |
| 3 | Testes da web (critérios 6 e 7), que falham | em `apps/web`: `pnpm test` |
| 4 | `invoiceCandidatesForProduct` em `lib/` + `loadInvoiceCandidates` no componente, substituindo os dois loops | test, lint, `tsc --noEmit` e build da web |
| 5 | Revisão do próprio diff: casos de borda (invoice sem PO, todas as POs ausentes, PO com zero itens), código morto, escopo | — |

## 5. Deploy e validação

A ordem importa: **API primeiro, web depois**. O Preview com a tela nova chama a rota batch, que precisa existir antes.

1. Compilar e ativar `hml-release-<sha>` na VPS seguindo [deploy/hostinger/README.md](../deploy/hostinger/README.md): `git archive`, reaproveitar o `node_modules` do release ativo (dependências inalteradas), novo drop-in e backup do drop-in anterior em `/var/backups/import-erp/`.
2. Conferir o health `200` e chamar a rota batch para a PO 030201 (somente leitura). Confirmar no log uma única requisição.
3. `git push production homologacao` e acompanhar o deployment Preview até `Ready`, conferindo branch e commit.
4. No Preview, subir a IPH034A: destinos maiores que zero, sem "HTTP 500" e com "Revalidar POs e saldos" funcionando (critério 8).
5. Registrar o release, o backup e o resultado no README de deploy.
6. Promoção para `main` por Pull Request só depois da sua aprovação dos testes.

**Rollback:** remover o drop-in novo, `systemctl daemon-reload` e reiniciar `import-erp-hml-api`, que volta ao release anterior; reverter o commit da web. A mudança é aditiva, então a rota GET continua atendendo a produção.

## 6. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/api/src/api-error-response.ts` | Novo: tratamento de erros com o caso 429 |
| `apps/api/src/server.ts` | Usa `registerApiErrorHandler` |
| `apps/api/src/operations.ts` | Schema `invoiceCandidateBatch` + rota `POST …/invoice-candidates/batch` |
| `apps/api/package.json` | Inclui `test/api-error-response.test.mjs` no script `test` |
| `apps/api/test/operations.test.mjs` | Testes da rota batch |
| `apps/api/test/web-route-contract.test.mjs` | Rota nova na lista |
| `apps/api/test/api-error-response.test.mjs` | Novo |
| `apps/web/lib/china-invoice-mapping.ts` | `invoiceCandidatesForProduct` |
| `apps/web/components/NewOperationalRecord.tsx` | `loadInvoiceCandidates` substitui os dois loops |
| `apps/web/test/*.test.mjs` | Ordenação dos candidatos e uso da rota batch |
| `deploy/hostinger/README.md` | Registro do release HML |

## 7. Riscos e cuidados

- **Ordem de deploy:** se o Preview subir antes da API, a tela recebe 404 na rota batch. Por isso a API vai primeiro.
- **Tamanho da resposta:** uma invoice com muitas POs grandes devolve todas as linhas dessas POs. Ainda assim é bem menos que hoje (cada PO uma vez) e fica abaixo do limite de corpo de 1 MB, que vale só para a requisição.
- **Normalização do número da PO:** é feita só no SQL e é a mesma da rota GET, então JS e SQL não podem divergir.
- **A cota continua compartilhada:** sem `trustProxy`, outros usuários consumindo chamadas ainda podem levar ao 429. A tela, porém, passa a mostrar quanto tempo esperar.

## 8. Pendências fora deste plano

1. **Divergência de fornecedor:** o campo Exporter da invoice traz nome e endereço (`HEXING ELECTRICAL CO.,LTD SHANGCHENG INDUSTRIAL ZONE…`), e a comparação exige igualdade com o cadastro (`HEXING ELECTRICAL CO.,LTD HANGZHOU`). Isso gera aviso em toda linha desse fornecedor.
2. **Equivalência de unidades:** a invoice usa `PCS`, e as POs usam `UN` (431 itens no HML) ou `PC` (17). A comparação literal gera aviso em toda linha.
3. **`trustProxy`:** a API enxerga todas as chamadas como vindas do proxy `172.18.0.16`, então todos os usuários dividem os 120 por minuto, e o limite de login (10 por minuto) também é coletivo. Plano próprio em [PLANO_RATE_LIMIT_CLIENTE.md](PLANO_RATE_LIMIT_CLIENTE.md), que conclui que `trustProxy` não resolve e propõe outra abordagem.
4. **Dados do HML:** a PO 030321 não está cadastrada, e a cópia da PO 030201 (importada em 2026-10-21) não tem o item 2070700600.

## 9. Resultado da execução

- API: commit `353baf7`; web: commit `64ecb66`; registro de deploy: commit
  `570d0eb`.
- API HML: release `hml-release-64ecb66`, serviço ativo e health 200; backup do
  drop-in anterior em
  `/var/backups/import-erp/hml-invoice-batch-64ecb66-predeploy`.
- Validação real somente leitura: banco `erp_po_totvs_hml`, role
  `import_erp_hml_app`, PO 030201 encontrada com 215 itens ativos, exatamente
  duas consultas e resposta sem o campo interno `sourcePoNumber` nos itens.
- Preview: deployment `dpl_DF5jNCKnXR6N1k4YfBKKauTP3bM5` em `Ready`, branch
  `homologacao`, commit `570d0eb`; `/login` validado no alias estável.
- Testes locais: suíte completa da API, 148 testes web, lint sem erros (40
  avisos preexistentes), type-check e builds da API e da web passaram.
- Pendente: o upload autenticado da `IPH034A 2026 INV+PL.xlsx` não foi
  executado porque o arquivo não existe no workspace. A IPH034B disponível foi
  analisada separadamente, sem substituir esse critério de aceite.
