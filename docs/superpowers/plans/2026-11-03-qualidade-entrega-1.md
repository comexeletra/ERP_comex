# Qualidade dos dados — Entrega 1 (tela clara) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela `/quality` explica cada pendência da carga, mostra a evidência rotulada com links, resume e filtra por
tipo, busca por texto e resolve sem JSON (requisitos 1–8 de `docs/PLANO_QUALIDADE_DADOS.md`).

**Architecture:** A API `GET /api/v1/data-issues` ganha `search`, `countsByCode` e `links` por item, sem mudar o
contrato de resolução. O web ganha `lib/quality-issues.ts` (funções puras que recebem `m: Messages`), fichas e rótulos
nos três dicionários e a página reescrita com componentes padrão.

**Tech Stack:** Fastify + pg + zod (API, testes `node test/*.mjs` sobre `dist/`), Next.js 16 + React 19 (web, testes
`node --experimental-strip-types --test`).

---

## Arquivos

- Modify: `apps/api/src/data-issues.ts` — filtro `search`, `countsByCode`, `links`.
- Modify: `apps/api/test/data-issues.test.mjs` — testes da listagem e contrato do payload da tela.
- Create: `apps/web/lib/quality-issues.ts` — ficha, status, severidade, campos da evidência, payload de resolução.
- Modify: `apps/web/lib/quality-permissions.ts` — Logística.
- Modify: `apps/web/lib/i18n/pt-BR.ts`, `en.ts`, `zh-CN.ts` — bloco `quality`.
- Modify: `apps/web/app/quality/page.tsx` — tela.
- Modify: `apps/web/app/styles/features/analysis.css`, `apps/web/app/styles/components.css` — regras novas.
- Create: `apps/web/test/quality-page.test.mjs` — fichas, rótulos, payload, permissões, tela.

### Task 1: API — `search`, `countsByCode` e `links`

- [ ] **Step 1: testes que falham** em `apps/api/test/data-issues.test.mjs`:

```js
test("quality list counts by code within status and search, and links PO and IP in scope", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET",
    url: "/api/v1/data-issues?status=open&search=%20031178%20", headers: { "x-test-subject": "buyerA" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().countsByCode, [{ code: "PRICE_WITHOUT_CURRENCY", count: 2 }]);
  // Search is a parameter, never SQL text, and matches the evidence without LIKE wildcards.
  assert.equal(state.listValues.at(-1), "031178");
  assert.match(state.listSql, /strpos\(lower\(issue\.evidence::text\), lower\(\$7\)\) > 0/u);
  // Counts by code ignore the code filter so the summary keeps every type visible.
  assert.match(state.listSql, /FROM scoped\s+WHERE \$4 = 'all'/u);
  // PO and IP links reuse the importer scope of the caller.
  assert.match(state.listSql, /po_line_observation AS link_obs[\s\S]*link_po\.importer = ANY\(\$1::text\[\]\)/u);
  assert.match(state.listSql, /import_process AS link_ip[\s\S]*link_ip\.importer = ANY\(\$2::text\[\]\)/u);
  assert.match(state.listSql, /link_ip\.deleted_at IS NULL/u);
});

test("quality list rejects a search longer than 80 characters", async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: `/api/v1/data-issues?search=${"x".repeat(81)}`,
    headers: { "x-test-subject": "buyerA" } });
  assert.equal(response.statusCode, 400);
});

test("the resolution payload built by the quality screen is accepted", async (t) => {
  const { qualityResolutionPayload } = await import("../../web/lib/quality-issues.ts");
  const { app } = await createApp();
  t.after(() => app.close());
  const payload = qualityResolutionPayload({ reference: " INV-9 ", reason: " Conferido. ",
    proposedPurchaseOrder: " ", proposedIpNumber: "003C/2026" });
  const response = await app.inject({ method: "POST", url: `/api/v1/data-issues/${issueIds.visible}/resolve`,
    headers: headers("buyerA", "screen-payload-key"), payload });
  assert.equal(response.statusCode, 201);
});
```

O dublê de `pool.query` passa a guardar `state.listValues = values` e devolver
`counts_by_code: [{ code: "PRICE_WITHOUT_CURRENCY", count: 2 }]`.

- [ ] **Step 2:** `cd apps/api && npm run build && node test/data-issues.test.mjs` — falha (sem `countsByCode`, sem
  `search`, módulo web inexistente).
- [ ] **Step 3: implementação** em `data-issues.ts`:
  - `listQuerySchema` com `search: z.string().trim().max(80).optional()`.
  - `visibleIssueSql` devolve também `poScopeSql` e `processScopeSql` (os mesmos `$n` usados no `EXISTS`; `TRUE` para
    Master).
  - CTEs: `scoped` (escopo + busca), `visible` (`scoped` + código), `filtered` (status), `page` (com `links`).
    Valores: `[...visible.values, code, status, pageSize, offset, search]`; a busca é o último parâmetro.
  - `links` por item:

```sql
jsonb_strip_nulls(jsonb_build_object(
  'purchaseOrderId', (SELECT CASE WHEN count(DISTINCT link_po.id) = 1 THEN min(link_po.id::text) END
    FROM procurement.po_line_observation AS link_obs
    JOIN procurement.purchase_order AS link_po ON link_po.id = link_obs.purchase_order_id
    WHERE link_obs.source_row_id = filtered.source_row_id AND ${poScopeSql}),
  'processId', (SELECT CASE WHEN count(*) = 1 THEN min(link_ip.id::text) END
    FROM imports.import_process AS link_ip
    WHERE link_ip.normalized_ip_number = upper(btrim(filtered.evidence->>'ipNumber'))
      AND link_ip.deleted_at IS NULL AND ${processScopeSql})
)) AS links
```

  - `counts_by_code`: `SELECT issue_code AS code, count(*)::int AS count FROM scoped WHERE <status> GROUP BY issue_code`,
    agregado em `jsonb_agg(... ORDER BY count DESC, code)`.
  - Resposta: `countsByCode: result.rows[0]?.counts_by_code ?? []`.
- [ ] **Step 4:** build e teste passam (o teste de resolução da tela depende da Task 2, Step 3).
- [ ] **Step 5:** commit `feat(quality): count issues by type, search evidence and link PO and IP`.

### Task 2: Web — `lib/quality-issues.ts`, permissões e dicionários

- [ ] **Step 1: testes que falham** em `apps/web/test/quality-page.test.mjs` cobrindo: ficha conhecida e desconhecida;
  status, severidade e resultado traduzidos com fallback; campos da evidência em ordem fixa, lista unida por vírgula,
  nulo como "—", chave desconhecida com o próprio nome; payload com `trim` e `null`; todo código conhecido com ficha
  completa nos três idiomas; papéis web iguais aos que têm `quality.resolve` em `apps/api/src/authorization.ts`.
- [ ] **Step 2:** `cd apps/web && node --experimental-strip-types --test test/quality-page.test.mjs` — falha.
- [ ] **Step 3: implementação**

```ts
// apps/web/lib/quality-issues.ts
import type { Messages } from "./i18n/pt-BR";

export type QualityIssueText = { title: string; meaning: string; impact: string; fix: string };
export type QualityEvidenceField = { key: string; label: string; value: string };

/** Load issue codes written by the workbook loaders (deploy/hostinger/import-*.py). */
export const qualityIssueCodes = ["MISSING_PO", "PRICE_WITHOUT_CURRENCY", "SC_MULTIPLE_SUPPLIERS", "PO_WITHOUT_SUPPLIER",
  "INVALID_DATE", "PO_IP_SUPPLIER_DIVERGENCE", "EXCEL_CELL_ERROR", "INVALID_NUMERIC", "INVALID_CURRENCY",
  "INVALID_STATUS", "INVALID_COST"] as const;

const evidenceOrder = ["purchaseOrder", "draftPo", "ipNumber", "scNumber", "productCode", "importer", "poSupplier",
  "ipSupplier", "suppliers", "unitPrice", "currency", "amount", "column", "value"];

export function qualityIssueText(m: Messages, code: string): QualityIssueText & { known: boolean } {
  const text = (m.quality.issueTypes as Record<string, QualityIssueText | undefined>)[code];
  return text ? { ...text, known: true }
    : { title: m.quality.unknownType, meaning: m.quality.unknownMeaning(code), impact: "", fix: "", known: false };
}

export function qualityStatusLabel(m: Messages, status: string): string {
  return (m.quality.statuses as Record<string, string | undefined>)[status] ?? status;
}

export function qualitySeverityLabel(m: Messages, severity: string): string {
  return (m.quality.severities as Record<string, string | undefined>)[severity] ?? severity;
}

export function qualityOutcomeLabel(m: Messages, outcome: string): string {
  return (m.quality.outcomes as Record<string, string | undefined>)[outcome] ?? outcome;
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(display).join(", ") : "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function qualityEvidenceFields(m: Messages, evidence: Record<string, unknown>): QualityEvidenceField[] {
  const labels = m.quality.evidenceLabels as Record<string, string | undefined>;
  const rank = (key: string) => { const index = evidenceOrder.indexOf(key); return index < 0 ? evidenceOrder.length : index; };
  return Object.keys(evidence).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(key => ({ key, label: labels[key] ?? key, value: display(evidence[key]) }));
}

export function qualityResolutionPayload(form: { reference: string; reason: string;
  proposedPurchaseOrder?: string; proposedIpNumber?: string }) {
  const optional = (value?: string) => value?.trim() || null;
  return { evidence: { reference: form.reference.trim() }, reason: form.reason.trim(),
    proposedPurchaseOrder: optional(form.proposedPurchaseOrder), proposedIpNumber: optional(form.proposedIpNumber) };
}
```

  `quality-permissions.ts` inclui `"Logística"`. Dicionários: substituem `invalidEvidence`, `evidenceLabel` e
  `evidencePlaceholder` por `issueTypes` (11 fichas), `unknownType`, `unknownMeaning(code)`, `statuses`, `severities`,
  `outcomes`, `evidenceLabels`, `meaning`, `impact`, `fix`, `foundData`, `technicalDetails`, `technicalCode(code)`,
  `byType`, `allTypes`, `type`, `search`, `searchPlaceholder`, `openPo`, `openIp`, `reference`, `referencePlaceholder`,
  `typeCount(title, count)`.
- [ ] **Step 4:** testes passam; `npx tsc --noEmit` passa.
- [ ] **Step 5:** commit `feat(quality): explain each issue type in the three languages`.

### Task 3: Web — tela

- [ ] **Step 1: testes que falham** (leitura do fonte, no estilo de `e2e-lines-view.test.mjs`): o cartão usa
  `qualityIssueText`, `qualityStatusLabel` e `qualitySeverityLabel`, não renderiza `{item.code}` como título nem
  `{item.status}`; o resumo usa `countsByCode` com `aria-pressed` e clicar no tipo selecionado limpa o filtro; a busca
  envia `search`; o formulário não tem `textarea name="evidence"` e usa `qualityResolutionPayload`; links para
  `/purchase-orders/` e `/processes/`; o JSON fica em `t.technicalDetails`; toda classe nova tem regra no CSS.
- [ ] **Step 2:** falha.
- [ ] **Step 3:** reescrever `app/quality/page.tsx` e acrescentar regras `.quality-type-summary`, `.quality-type-chip`,
  `.quality-explain`, `.quality-links` em `analysis.css`; `.quality-filter` passa a quatro colunas em `components.css`.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` no web; `npm run build && npm test`
  na API.
- [ ] **Step 5:** commit `feat(quality): clearer quality screen with type summary and labelled evidence`.

### Task 4: Publicação

- [ ] Push `git push production homologacao`; Preview `Ready` pelo `vercel ls`.
- [ ] Deploy da API no HML conforme `deploy/hostinger/README.md` (pacote `git -c core.autocrlf=false archive`, backup
  do serviço, health `200`), e conferência de `GET /api/v1/data-issues?status=open` com `countsByCode` somando 174.
- [ ] Validar a tela no Preview.
