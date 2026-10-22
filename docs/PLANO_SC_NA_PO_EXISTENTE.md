# Tarefa: criar e vincular a SC numa PO já cadastrada

| Item | Valor |
|---|---|
| Data | 2026-10-21 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | Especificação aguardando revisão |

## Objetivo

POs cadastradas antes da criação de SC junto com a PO, ou restauradas, podem ter o número da SC só como
texto nos itens (ex.: PO `030201` com "Número da SC" 020028), sem SC cadastrada nem vinculada. A página
da PO passa a oferecer **Criar SC e vincular**, sem precisar passar pelo PCM.

## Decisões já tomadas

- A ação fica na página da PO, para POs ativas sem SC vinculada.
- Quem pode criar PO (`purchase-orders.write`) pode criar a SC **por este fluxo**, como no cadastro da PO.
- Só o solicitante é obrigatório; as datas são opcionais.
- Se a SC já existir com o mesmo fornecedor, ela é vinculada; com outro fornecedor, a operação é
  bloqueada.

## Requisitos

### API — `POST /api/v1/purchase-orders/:id/purchase-request`

1. Permissão `purchase-orders.write`, versão no `X-Record-Version` e corpo
   `{ scNumber, requester, scDate, approvalDate, commercialPlanReceivedDate, reason }`. As datas são ISO
   ou `null`, e o motivo tem de 3 a 1000 caracteres.
2. Numa transação:
   1. bloqueia a PO no escopo;
   2. exige PO ativa (`PO_NOT_ACTIVE`), versão atual (`VERSION_CONFLICT`), PO sem SC vinculada
      (`409 PO_ALREADY_HAS_PURCHASE_REQUEST`) e fornecedor preenchido (`409 PO_SUPPLIER_REQUIRED`);
   3. cria ou reaproveita a SC com `resolvePurchaseRequestForCompletePo`, usando a importadora e o
      fornecedor da PO. Fornecedor diferente retorna `409 PURCHASE_REQUEST_SUPPLIER_MISMATCH`;
   4. grava `purchase_request_id`, incrementa a versão e registra `PURCHASE_ORDER / UPDATE`;
   5. aplica os campos da SC a todos os itens, como a edição da PO já faz, com `FOLLOWUP_UPDATE` por
      item.
3. Responde `{ purchaseRequestId, created, version }`. `created` indica se a SC foi criada ou
   reaproveitada; para isso, `resolvePurchaseRequestForCompletePo` passa a devolver `created`.
4. A mensagem `PURCHASE_REQUEST_RESOLUTION_FAILED`, hoje com acentos corrompidos, é corrigida.

### Web — página da PO

5. Para PO ativa, sem SC vinculada e com permissão de edição, aparece o bloco **SC da PO**:
   - número da SC sugerido a partir dos itens (o valor mais frequente de "Número da SC"), editável;
   - se a lista de SCs da importadora já tiver esse número, o bloco orienta selecioná-la no campo SC e
     salvar, que é o fluxo atual. Se o fornecedor for diferente, avisa o conflito;
   - se não houver, mostra Solicitante (obrigatório), data da SC, data de aprovação e recebimento do
     plano comercial, e o botão **Criar SC e vincular**;
   - após o sucesso, a PO é recarregada e o campo SC mostra a SC vinculada.
6. A sugestão de número fica numa função pura testável.

## Restrições

- Sem migration. Reaproveitar `resolvePurchaseRequestForCompletePo`, `validatePurchaseRequest`,
  `purchaseRequestOperationalFields`, `record` e `lockedPo`.
- A `030201` real não é alterada pelo agente; o usuário faz a vinculação pela tela.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Cria a SC, vincula à PO, incrementa a versão e aplica os campos da SC aos itens, com auditoria | API (`purchase-order-sc-link.test.mjs`) |
| 2 | SC existente com o mesmo fornecedor é reaproveitada (`created: false`) | API |
| 3 | Fornecedor diferente, PO com SC, PO não ativa, versão divergente e solicitante ausente são recusados sem gravar | API |
| 4 | O papel Compras pode usar a rota; o papel Consulta não | API |
| 5 | A rota está no contrato web↔API | `web-route-contract.test.mjs` |
| 6 | A sugestão escolhe o número mais frequente e ignora vazios | Web |
| 7 | No HML, uma PO sintética sem SC recebe a SC criada e vinculada. Ao final, a PO é excluída e a SC é apagada pela rota de SC | Validação registrada no README de deploy |

## Fora do escopo

- Criar ou vincular SC no Substituir pela planilha.
- Trocar uma SC já vinculada por outra (continua pela edição da PO).
- Alterar a PO `030201` real.

## Plano

1. Testes da API e da função web, confirmando que falham.
2. API: rota, `created` no helper e mensagem corrigida. Build e testes. Commit.
3. Web: bloco SC da PO e função de sugestão. Testes, lint, type-check e build. Commit.
4. Push, Preview, release da API no HML, validação sintética e registro no README. Commit e push.
