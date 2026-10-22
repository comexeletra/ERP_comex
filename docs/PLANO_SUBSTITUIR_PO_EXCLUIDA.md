# Tarefa: restaurar ou substituir a PO excluída ao subir a planilha

| Item | Valor |
|---|---|
| Data | 2026-10-21 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | Especificação aguardando revisão |

## Objetivo

Ao subir a planilha de uma PO cujo número já existe como **PO excluída na mesma importadora**, a tela
hoje só avisa que é preciso restaurá-la pela carteira. O aviso passa a oferecer as ações: abrir a PO
excluída, restaurá-la, ou substituí-la pela planilha. Substituir significa restaurar a PO e sincronizar
os itens com a planilha numa única transação.

## Decisões já tomadas

- **Substituir = restaurar + aplicar a planilha** na mesma PO. O histórico é preservado e não há
  migration.
- A sincronização é **total**: atualiza as linhas iguais, inclui as novas, remove as que saíram,
  reativa as que voltaram e troca o produto de uma linha quando ele mudou.
- **Restaurar** e **Substituir** ficam disponíveis só para Master e Administrador
  (`purchase-orders.lifecycle.manage`), como a restauração de hoje.
- A unicidade `(purchase_order_id, external_line_reference)` do item continua. Por isso, uma linha que
  volta à planilha ou muda de produto é atualizada no próprio item, e não removida e recriada.

## Requisitos

### API — pré-validação (`POST /api/v1/purchase-orders/preflight`)

1. Além de `sameImporterDeleted`, a resposta inclui
   `sameImporterDeletedPurchaseOrder: { id, version, replaceSupported } | null`. Esse objeto só vem
   preenchido quando existe PO `DELETED` com o mesmo número na importadora escolhida.
   `replaceSupported` é verdadeiro quando `source_kind = 'MANUAL_TOTVS_REFERENCE'`.

### API — cálculo da sincronização (função pura)

2. Nova função `calculatePurchaseOrderReplacePlan(currentRows, incomingRows, currency)` em
   `operations.ts`, que reaproveita as comparações de `calculatePurchaseOrderReimportDiff`. Ela
   classifica cada linha:
   - `updated`: o Item existe, não está removido, o produto é o mesmo e mudou descrição, quantidade,
     preço ou moeda;
   - `added`: o Item só existe na planilha;
   - `removed`: o Item está ativo na PO e não está na planilha;
   - `reactivated`: o Item está removido (`source_status` cancelado) e voltou na planilha;
   - `productChanged`: o Item existe e o código do produto é diferente.
3. Ficam em `blockers`, e a substituição não pode ser aplicada, quando:
   - uma linha `removed` ou `productChanged` tem alocação de IP ativa;
   - o fornecedor da planilha é diferente do fornecedor da PO;
   - a PO não é `MANUAL_TOTVS_REFERENCE`;
   - o número da planilha é diferente do número da PO.
4. As linhas da planilha que entram na PO (`added`, `reactivated` e `productChanged`) precisam de
   unidade e centro de custo, e passam por `validatePurchaseOrderItems` (produto ativo no catálogo,
   UM e centro de custo cadastrados). Uma falha nessa validação também entra em `blockers`.

### API — prévia (`POST /api/v1/purchase-orders/:id/replace/preview`)

5. Permissão `purchase-orders.lifecycle.manage` e PO dentro do escopo; só aceita PO `DELETED`.
6. O corpo tem o mesmo formato da reimportação, acrescido de `supplierCode` e, por item, de `unit` e
   `costCenter`.
7. A resposta traz a versão da PO, as listas do item 2, `blockers` e `canApply`. Nada é gravado.

### API — aplicação (`POST /api/v1/purchase-orders/:id/replace`)

8. Mesma permissão e corpo, com `reason` (3 a 1000 caracteres) e a versão no `X-Record-Version`.
9. Numa única transação:
   1. bloqueia a PO;
   2. confere a versão e se ela está `DELETED`;
   3. recalcula o plano; se houver `blockers`, responde `409 PO_REPLACE_BLOCKED` com a lista e não
      altera nada;
   4. restaura a PO usando a mesma regra de transição (`DELETED → ACTIVE`) e a mesma auditoria da
      restauração atual;
   5. aplica o plano:
      - `updated`: atualiza os campos, como a reimportação faz hoje;
      - `added`: insere o item na próxima `line_number`, com NCM do produto, centro de custo e campos
        da SC vinculada à PO;
      - `removed`: marca `source_status='CANCELLED'`, como na remoção de item;
      - `reactivated` e `productChanged`: atualizam o próprio item (produto, descrição, quantidade,
        preço, moeda, UM, centro de custo e NCM) e limpam `source_status`;
   6. registra cada alteração em `audit.audit_log` (`CREATE`, `UPDATE`, `REMOVE`), com o arquivo de
      origem e o motivo;
   7. incrementa a versão da PO.
10. Responde com o id, a nova versão e as contagens por tipo. Se qualquer passo falhar, a PO
    continua excluída e nada muda.

### Web — tela de nova PO (aviso de PO excluída)

11. Quando a pré-validação indicar PO excluída na mesma importadora, o aviso mostra:
    - **Abrir PO excluída**: link para `/purchase-orders/{id}`, para todos os papéis;
    - para Master e Administrador, **Restaurar PO**: pede motivo, chama a rota de restauração
      existente e abre a página da PO;
    - para Master e Administrador, **Substituir pela planilha**: só aparece se `replaceSupported` for
      verdadeiro. Mostra a prévia com contagens, a lista por tipo (até 20 linhas por tipo e o total) e
      os `blockers`, pede o motivo e, ao confirmar, aplica e abre a página da PO;
    - para os demais papéis, o texto: "Peça a um Master ou Administrador para restaurar ou substituir
      esta PO."
12. O botão "Salvar PO e produtos" continua bloqueado nesse caso.
13. A decisão de quais ações mostrar fica numa função pura testável em `lib/po-lifecycle.ts`.

## Restrições

- Sem migration e sem mudança nas regras de unicidade de PO e de item.
- A reimportação de PO ativa (`/reimport`) continua com as regras atuais.
- Reaproveitar `changePurchaseOrderLifecycle`, `validatePurchaseOrderItems`, `validatePurchaseRequest`,
  `purchaseRequestOperationalFields`, `record` e `lockedPo`.
- Validação somente no HML, com PO sintética `HMLVAL`; a PO `030201` real não é alterada sem pedido.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Pré-validação devolve id, versão e `replaceSupported` da PO excluída na mesma importadora | API (`purchase-order-preflight.test.mjs`) |
| 2 | O plano classifica `updated`, `added`, `removed`, `reactivated` e `productChanged` corretamente | API (`purchase-order-replace.test.mjs`, função pura) |
| 3 | Remoção ou troca de produto em linha com IP alocado, fornecedor diferente, número diferente e origem histórica geram `blockers` | API |
| 4 | Prévia não grava nada e recusa PO que não está excluída | API |
| 5 | Aplicação restaura e sincroniza na mesma transação, com auditoria de cada alteração e versão incrementada | API |
| 6 | Com `blockers`, a aplicação responde 409 e a PO continua excluída | API |
| 7 | Compras e Importação recebem 403 na prévia e na aplicação; versão divergente retorna 409 | API |
| 8 | As rotas novas estão no contrato web↔API | `web-route-contract.test.mjs` |
| 9 | As ações do aviso variam conforme papel e `replaceSupported` | Web (`api-compat.test.mjs`) |
| 10 | No HML, uma PO sintética excluída é substituída por uma planilha com linha nova, removida e alterada. As contagens e a auditoria são conferidas, e a PO volta a ser excluída ao final | Validação registrada no README de deploy |

## Fora do escopo

- Trocar o fornecedor ou a SC da PO pelo Substituir. Fornecedor diferente bloqueia; a SC vinculada é
  mantida e a SC da planilha não é criada nem vinculada nesse fluxo.
- Sincronização total na reimportação de PO ativa.
- Liberar Restaurar ou Substituir para Importação e Compras.
- Substituir PO excluída em outra importadora (esse caso já não bloqueia a criação).

## Plano

1. Testes da pré-validação, da função de plano e das rotas (critérios 1–8), confirmando que falham.
2. API: pré-validação, função de plano, prévia e aplicação. Rodar build e testes. Commit.
3. Web: função das ações, aviso com Abrir, Restaurar e Substituir, prévia e confirmação. Rodar testes,
   lint, type-check e build. Commit.
4. Push para `homologacao` e conferir o Preview.
5. Publicar a API no HML (release novo, backup do drop-in, reinício, health) e validar com PO sintética
   (critério 10). Registrar no `deploy/hostinger/README.md`. Commit e push.
