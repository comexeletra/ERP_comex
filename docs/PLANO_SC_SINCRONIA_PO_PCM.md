# Tarefa: dados da SC editados na PO passam a atualizar a SC no PCM

| Item | Valor |
|---|---|
| Data | 2026-10-22 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | Implementado na `homologacao` (`fce5a77`, `5668fa3`, `a71ed42`); API HML no release `a71ed42`, validação sintética concluída e SC `020028` preenchida no HML. Falta a conferência da tela pelo usuário. Sem PR para `main` por decisão do usuário. |

## Diagnóstico (HML, 2026-10-22)

- A SC `020028` da PO `030201` tem só o solicitante. Os 215 itens têm data da SC 2026-10-01, aprovação
  2026-10-05 e plano comercial 2026-10-11, gravados às 13:11 por "Aplicar campos alterados a todos os
  produtos".
- A sincronização existe só no sentido PCM → PO (`PATCH /api/v1/purchase-requests/:id` atualiza os itens
  cujo valor ainda era igual ao da SC).
- `PATCH /api/v1/purchase-orders/:id/items/followup` grava só nos itens.
- `PATCH /api/v1/purchase-orders/:id/complete` (salvar a PO com campos compartilhados) sobrescreve os campos
  enviados com os valores da SC vinculada, descartando a edição.

## Objetivo

Com SC vinculada, data da SC, data de aprovação da SC, solicitante e recebimento do plano comercial editados
nos dados compartilhados da PO passam a atualizar a SC no PCM na mesma transação, e as demais POs da SC
recebem a mudança como já acontece na edição pelo PCM.

## Requisitos

1. Uma função comum na API, usada por `PATCH /items/followup` e por `PATCH /complete` (quando a SC da PO não
   muda), compara os campos enviados com a SC vinculada:
   - campos sincronizados: `scDate → sc_date`, `scApprovalDate → approval_date`, `requester → requester`,
     `commercialPlanReceivedDate → commercial_plan_received_date`;
   - `scNumber` diferente do número da SC (normalizado) → `409 PURCHASE_REQUEST_NUMBER_LOCKED`;
   - `requester` vazio → `409 PURCHASE_REQUEST_REQUESTER_REQUIRED`, porque a SC exige o solicitante;
   - sem diferença → a SC não é alterada;
   - com diferença: bloqueia a SC, exige todas as POs vinculadas ativas (mesma regra e mensagem do PCM,
     `409 PO_NOT_ACTIVE`), atualiza a SC (`version + 1`), registra `PURCHASE_REQUEST / UPDATE` com antes e
     depois e o motivo, e aplica a mudança aos itens das outras POs da SC com a mesma regra do PCM (só os
     itens cujo valor era igual ao anterior da SC), incrementando a versão dessas POs.
2. `PATCH /complete` passa a gravar nos itens os valores editados (agora iguais aos da SC). Se a requisição
   trocar a SC vinculada, o comportamento atual continua: valem os dados da nova SC.
3. `PATCH /items/:itemId/followup` recusa, com `409 PURCHASE_REQUEST_FIELDS_SHARED`, valores de campos da SC
   diferentes da SC vinculada. Isso evita item divergente da SC.
4. As respostas de `PATCH /items/followup` e `PATCH /complete` incluem `purchaseRequestUpdated`.
5. Web: com SC vinculada, o **Número da SC** fica somente leitura nos dados compartilhados, com a explicação
   de que as datas e o solicitante também atualizam a SC no PCM. Após salvar, a mensagem informa quando a SC
   foi atualizada.
6. Permissões não mudam: quem edita PO (`purchase-orders.write`) atualiza esses quatro campos da SC por este
   caminho, como no cadastro da SC junto com a PO.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Aplicar campos da SC numa PO com SC atualiza a SC, registra auditoria e propaga para outra PO da SC | API (`purchase-order-sc-sync.test.mjs`) |
| 2 | Sem diferença em relação à SC, a SC não é alterada | API |
| 3 | Número da SC diferente, solicitante vazio e PO vinculada não ativa são recusados sem gravar | API |
| 4 | `PATCH /complete` grava os valores editados na SC e nos itens; com troca de SC, valem os dados da nova SC | API |
| 5 | Edição por item com campo da SC divergente é recusada | API |
| 6 | PO sem SC continua igual (regressão) | API (testes existentes) |
| 7 | Campos bloqueados com SC vinculada | Web (função pura) |
| 8 | No HML, PO sintética com SC: aplicar datas atualiza a SC no PCM; limpeza ao final | Teste opt-in HML |
| 9 | SC `020028` do HML preenchida com os valores dos itens da `030201`, com auditoria | Conferência no HML |

## Fora do escopo

- Alterar o número, a importadora ou o fornecedor da SC pela PO.
- Mudar as regras da edição pelo PCM.
- PR para `main` (o usuário pediu só homologação).

## Plano

1. Testes da API (1–6) e da função web (7), confirmando que falham.
2. API: função comum de sincronização, extraindo a propagação de itens hoje em `purchase-requests.ts`;
   uso nas duas rotas e recusa na rota por item. Build e testes. Commit.
3. Web: Número da SC somente leitura, explicação e mensagem. Testes, lint, tipos e build. Commit.
4. Push, Preview, release da API no HML, teste opt-in (8) e preenchimento da SC `020028` pela própria rota
   (9). Registro no README de deploy. Commit e push.
