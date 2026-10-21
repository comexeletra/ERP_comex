# Tarefa: criar ou vincular a SC no cadastro da PO por planilha e excluir SC

| Item | Valor |
|---|---|
| Data | 2026-10-21 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | Especificação aguardando revisão |

## Objetivo

A planilha TOTVS da PO já traz o número da SC (`Nro.SC`). Hoje, se a SC não existe, a pessoa precisa
sair do cadastro, criá-la no PCM e voltar. O cadastro da PO passa a vincular automaticamente a SC
existente ou a criá-la junto com a PO, pedindo só o que a planilha não traz.

Também não há como excluir uma SC cadastrada por engano. O PCM passa a ter a exclusão definitiva,
com os dados e o motivo preservados na auditoria e o número liberado para novo cadastro.

A entrega tem duas partes independentes: **Parte A**, a SC junto com a PO (sem migration), e
**Parte B**, a exclusão de SC (com a migration M066, só de permissão).

## Decisões já tomadas

- Ao criar a SC, só o **solicitante** é obrigatório; data da SC, data de aprovação e recebimento do plano
  comercial ficam opcionais (podem ser completadas depois no PCM).
- Antes de criar, o sistema procura a SC para não duplicar. Se ela existir com o mesmo fornecedor, é
  vinculada automaticamente e seus dados são aplicados aos itens da PO.
- Se existir SC com o mesmo número na importadora, mas com outro fornecedor, o salvamento é **bloqueado**
  com aviso.
- Quem pode criar PO (`purchase-orders.write`) pode criar a SC **somente por este fluxo**. A permissão
  `purchase-requests.write` dos papéis não muda.
- A SC é criada na mesma transação da PO (abordagem 1): se a PO falhar, a SC não é criada.
- A exclusão de SC é **definitiva**: a linha sai do banco, o número fica livre e uma cópia dos dados,
  com o motivo, fica em `audit.audit_log` (visível no histórico da SC).
- A exclusão é recusada se houver PO **não excluída** (ativa, encerrada ou cancelada) vinculada. POs
  excluídas vinculadas são desvinculadas automaticamente, com auditoria, antes de apagar a SC.
- Pode excluir quem já edita SC (`purchase-requests.write`: Master, Administrador e PCM). O motivo é
  obrigatório.

## Requisitos

### Parte A — API — `POST /api/v1/purchase-orders/complete`

1. O `header` aceita o campo opcional `newPurchaseRequest`:
   `{ scNumber (1–80), requester (1–160), scDate, approvalDate, commercialPlanReceivedDate }`, com as
   datas no formato ISO ou `null`. Objeto estrito.
2. Enviar `newPurchaseRequest` junto com `purchaseRequestId` preenchido é recusado com `400`
   (`PURCHASE_REQUEST_CHOICE_CONFLICT`).
3. Dentro da transação, depois de `validateNewPurchaseOrder` (que já valida importadora, número e
   fornecedor), a SC é resolvida pela importadora e pelo número normalizado:
   - inserção com `ON CONFLICT (importer, normalized_sc_number) DO NOTHING`, que é segura contra criação
     simultânea;
   - se a SC já existia, ela é reaproveitada;
   - em seguida, `validatePurchaseRequest` confere o fornecedor. Se a SC tiver outro fornecedor, a rota
     responde `409 PURCHASE_REQUEST_SUPPLIER_MISMATCH` e nada é gravado.
4. A SC nova grava `supplier_text` igual ao fornecedor da PO e `created_by` no mesmo formato da rota de
   SC, além de um registro de auditoria `PURCHASE_REQUEST / CREATE` com o motivo da PO, para aparecer no
   histórico da SC.
5. A PO é criada com `purchase_request_id` da SC resolvida. Os campos da SC (data da SC, aprovação,
   solicitante, plano comercial) são aplicados aos itens como já acontece hoje com uma SC vinculada.
6. A resposta passa a incluir `purchaseRequestId` (inclusive no salvamento repetido).
7. Repetir o mesmo envio com a mesma chave de idempotência devolve a mesma PO e não cria outra SC.

### Parte A — Web — cadastro de PO por planilha

8. Ao ler a planilha, a SC é classificada por uma função pura (`lib/totvs-purchase-request.ts`), a partir
   das SCs já carregadas da importadora:
   - `none`: a planilha não tem `Nro.SC`. O comportamento atual continua.
   - `match`: existe SC com o mesmo número e fornecedor. Ela é vinculada automaticamente, e a pessoa pode
     desvincular no seletor de SC.
   - `supplier-mismatch`: existe SC com o mesmo número e outro fornecedor. O salvamento fica bloqueado e
     a tela mostra o número da SC e o fornecedor dela.
   - `missing`: não existe SC. Aparece o bloco "Criar SC {número} junto com a PO", com importadora,
     número e fornecedor só para leitura, **Solicitante** obrigatório e as três datas opcionais.
9. No caso `missing`, sem SC selecionada manualmente, o salvamento envia `newPurchaseRequest`. Se a
   pessoa selecionar outra SC no seletor, `newPurchaseRequest` não é enviado.
10. A conferência feita após o salvamento compara o `purchaseRequestId` gravado com o devolvido pela
    API, e não com o estado da tela.
11. Erros `PURCHASE_REQUEST_SUPPLIER_MISMATCH` e `PURCHASE_REQUEST_CHOICE_CONFLICT` aparecem com a
    mensagem da API.

### Parte B — Banco — migration `M066_purchase_request_delete.sql`

12. Concede `DELETE ON procurement.purchase_request` aos papéis `import_erp_app` e
    `import_erp_hml_app`, quando existirem. Nenhuma tabela, coluna ou dado muda.
13. Validação em cópia restaurada do HML antes de aplicar; aplicação somente em `erp_po_totvs_hml`,
    após backup. Produção não é alterada.

### Parte B — API — `DELETE /api/v1/purchase-requests/:id`

14. Permissão `purchase-requests.write`, versão esperada no cabeçalho `If-Match` (mesmo padrão do
    `PATCH`) e corpo `{ reason }` com 3 a 1000 caracteres.
15. Na transação, a SC é bloqueada (`FOR UPDATE`) dentro do escopo de importadoras; SC fora do escopo ou
    inexistente retorna `404`; versão divergente retorna `409 VERSION_CONFLICT`.
16. Se houver PO vinculada com `lifecycle_status <> 'DELETED'`, a rota responde
    `409 PURCHASE_REQUEST_IN_USE`, e a mensagem lista os números dessas POs. Nada é alterado.
17. Cada PO excluída vinculada tem `purchase_request_id` limpo, com registro de auditoria
    `PURCHASE_ORDER / UPDATE` (antes: id da SC; depois: `null`) e o mesmo motivo.
18. A SC é apagada e recebe o registro `PURCHASE_REQUEST / DELETE`, com os dados anteriores e o motivo.
    A resposta é `204`.

### Parte B — Web — tela do PCM

19. Botão **Excluir** em cada SC, visível para quem pode editar. Ele abre uma confirmação com o número da
    SC e o campo de motivo, obrigatório com no mínimo 3 caracteres.
20. Após excluir, a lista é recarregada. O erro `PURCHASE_REQUEST_IN_USE` aparece com a lista de POs
    devolvida pela API.

## Restrições

- Única migration: M066, só de permissão. Sem mudança na unicidade `(importer, normalized_sc_number)`
  da SC.
- Reaproveitar `receipt`/`saveReceipt`, `record`, `validateNewPurchaseOrder` e `validatePurchaseRequest`;
  não duplicar regras da rota `POST /api/v1/purchase-requests`.
- A tela do PCM e as permissões dos papéis não mudam.
- Sem dados de produção; validação somente no HML, com dados sintéticos e limpeza controlada.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | PO com `newPurchaseRequest` cria SC e PO vinculadas na mesma transação, com auditoria das duas | API (`purchase-order-complete-sc.test.mjs`) |
| 2 | SC existente com o mesmo fornecedor é reaproveitada, sem nova inserção | API |
| 3 | SC existente com outro fornecedor retorna 409 e nada é gravado | API |
| 4 | Sem solicitante, ou com `purchaseRequestId` e `newPurchaseRequest` juntos, retorna 400 | API |
| 5 | Papel Compras (sem `purchase-requests.write`) cria a SC por esta rota | API |
| 6 | Salvamento repetido devolve a mesma PO e `purchaseRequestId`, sem nova SC | API |
| 7 | A rota segue registrada no contrato web↔API | `web-route-contract.test.mjs` |
| 8 | Classificação `none` / `match` / `supplier-mismatch` / `missing`, com normalização de número e fornecedor | Web (`totvs-purchase-request.test.mjs`) |
| 9 | No HML, uma PO sintética (número e SC com prefixo `HMLVAL`) cria a SC junto e a SC aparece no PCM. Ao final, a PO é excluída logicamente e a SC sintética é excluída pela rota nova, com as contagens conferidas antes e depois | Validação registrada no README de deploy |
| 10 | M066 concede `DELETE` somente na tabela de SC aos papéis da aplicação | API (`purchase-request-migrations.test.mjs`) + validação em cópia restaurada |
| 11 | Exclusão de SC sem POs apaga a linha e registra a auditoria `DELETE` com os dados anteriores e o motivo | API (`purchase-request-delete.test.mjs`) |
| 12 | Exclusão com PO não excluída vinculada retorna 409 com os números das POs, sem alterar nada | API |
| 13 | POs excluídas vinculadas são desvinculadas, com auditoria, e a SC é apagada | API |
| 14 | Motivo ausente, versão divergente, SC fora do escopo e papel sem permissão (Compras) são recusados | API |
| 15 | A rota `DELETE /api/v1/purchase-requests/:id` está no contrato web↔API | `web-route-contract.test.mjs` |
| 16 | Depois de excluída, uma SC com o mesmo número pode ser cadastrada de novo | Validação no HML |

## Fora do escopo

- Migrations além da M066 e mudança na regra de unicidade da SC.
- Outras alterações na tela do PCM além do botão Excluir.
- Exclusão lógica ou restauração de SC.
- Exclusão de SC em lote.
- Editar uma SC existente durante o cadastro da PO.
- Guardar no rascunho local (sessionStorage) os campos da SC nova; ao recarregar a página, eles precisam
  ser preenchidos de novo.
- Cadastro manual de PO sem planilha (continua usando o seletor de SC atual).

## Plano

Parte A — SC junto com a PO

1. Testes da API (critérios 1–6) e da função web (critério 8), confirmando que falham.
2. API: schema de `newPurchaseRequest`, resolução da SC na transação e `purchaseRequestId` na resposta.
   Rodar build e testes da API. Commit.
3. Web: função de classificação, vínculo automático, bloco "Criar SC", bloqueio por conflito, payload e
   conferência após o salvamento. Rodar testes, lint, type-check e build. Commit.

Parte B — exclusão de SC

4. Testes da migration e da rota (critérios 10–15), confirmando que falham.
5. M066 e rota `DELETE`. Rodar build e testes da API. Commit.
6. Web: botão Excluir e confirmação no PCM. Rodar testes, lint, type-check e build. Commit.

Publicação e validação

7. Push para `homologacao` e conferir o Preview.
8. Backup do HML, validação da M066 em cópia restaurada e aplicação somente no HML.
9. Publicar a API no HML (release novo, backup do drop-in, reinício, health) e validar com dados
   sintéticos (critérios 9 e 16). Registrar em `deploy/hostinger/README.md` e no README de migrations.
   Commit e push.
