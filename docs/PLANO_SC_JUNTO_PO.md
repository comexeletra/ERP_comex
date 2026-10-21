# Tarefa: criar ou vincular a SC no cadastro da PO por planilha

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

## Requisitos

### API — `POST /api/v1/purchase-orders/complete`

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

### Web — cadastro de PO por planilha

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

## Restrições

- Sem migration e sem mudança na unicidade `(importer, normalized_sc_number)` da SC.
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
| 9 | No HML, uma PO sintética (número e SC com prefixo `HMLVAL`) cria a SC junto e a SC aparece no PCM. Ao final, a PO é excluída logicamente. A SC sintética permanece, porque o sistema não tem exclusão de SC e o papel HML não tem `DELETE`. As contagens são conferidas antes e depois | Validação registrada no README de deploy |

## Fora do escopo

- Migration ou mudança na regra de unicidade da SC.
- Alterações na tela do PCM.
- Editar uma SC existente durante o cadastro da PO.
- Guardar no rascunho local (sessionStorage) os campos da SC nova; ao recarregar a página, eles precisam
  ser preenchidos de novo.
- Cadastro manual de PO sem planilha (continua usando o seletor de SC atual).

## Plano

1. Testes da API (critérios 1–6) e da função web (critério 8), confirmando que falham.
2. API: schema de `newPurchaseRequest`, resolução da SC na transação e `purchaseRequestId` na resposta.
   Rodar build e testes da API. Commit.
3. Web: função de classificação, vínculo automático, bloco "Criar SC", bloqueio por conflito, payload e
   conferência após o salvamento. Rodar testes, lint, type-check e build. Commit.
4. Push para `homologacao` e conferir o Preview.
5. Publicar a API no HML (release novo, backup do drop-in, reinício, health) e validar com dados
   sintéticos (critério 9). Registrar no `deploy/hostinger/README.md`. Commit e push.
