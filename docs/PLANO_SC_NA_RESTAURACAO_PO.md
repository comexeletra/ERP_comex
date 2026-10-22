# Tarefa: SC e solicitante ao restaurar ou substituir a PO pela planilha, e data da restauração visível

| Item | Valor |
|---|---|
| Data | 2026-10-22 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | Implementado na `homologacao` (`cd9c67b`, `e8ea868`, `1104ee1`); API HML no release `1104ee1` e validação sintética concluída. Falta a conferência da tela pelo usuário no Preview (critério 13) e a vinculação da SC `020028` na `030201`. |

## Diagnóstico (conferido no HML em 2026-10-22, somente leitura)

Banco `erp_po_totvs_hml`, papel `import_erp_hml_app`, API HML no release `58dda50`.

- PO `030201` ativa (`e4307c96…`, importadora `ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L`,
  fornecedor `EX000135`): `created_at` 2026-10-21 19:50, `purchase_request_id` nulo. Os 215 itens têm
  `sc_number = 020028`; `requester`, `sc_date` e `sc_approval_date` estão vazios.
- A SC `020028` não existe. A única SC no HML é a `23754`, do fornecedor `EX000449`.
- Linha do tempo da auditoria da PO:
  - 21/10 19:50 `CREATE`, com a API `114fc1d`. A SC junto com a PO só entrou na API às 21:21
    (`83c3511`), então essa criação não podia gerar SC;
  - 21/10 21:31 `SOFT_DELETE`;
  - 21/10 22:12 `RESTORE`;
  - 22/10 12:24 `SOFT_DELETE`;
  - 22/10 12:26 `RESTORE` (motivo "necessidade").
- Hoje a PO **não foi recriada, e sim restaurada**. Ao carregar a planilha com o número de uma PO excluída
  na mesma importadora, a tela mostra "Restaurar PO" / "Substituir pela planilha"
  (`DeletedPurchaseOrderActions`). Esse caminho:
  1. não envia a SC (`Nro.SC`) nem o solicitante. `POST /:id/restore` e `POST /:id/replace` não aceitam SC.
     Por isso a SC não foi criada no PCM e o solicitante não chegou aos itens;
  2. reativa o mesmo registro, então `created_at` continua o da primeira criação. Ao voltar para `ACTIVE`,
     `lifecycle_changed_at/by/reason` são limpos, como exige a regra da M063/M064. A data da restauração
     fica só em `audit.audit_log` e não aparece na PO.
- A ação **SC da PO → Criar SC e vincular** (`PLANO_SC_NA_PO_EXISTENTE.md`) já existe na página da PO e
  resolve a `030201` manualmente, mas a vinculação ainda não foi feita.

## Objetivo

Ao restaurar ou substituir uma PO excluída a partir da planilha TOTVS, a SC da planilha passa a ser
vinculada ou criada, com o solicitante e as datas, na mesma transação da restauração, como já acontece na
criação. A página da PO passa a mostrar quando e por quem ela foi restaurada.

## Requisitos

### API — restaurar e substituir com SC

1. `POST /api/v1/purchase-orders/:id/replace` e `POST /api/v1/purchase-orders/:id/restore` aceitam um campo
   opcional e estrito `purchaseRequest`, com exatamente uma das formas:
   - `{ purchaseRequestId }`: vincular uma SC existente;
   - `{ newPurchaseRequest: { scNumber, requester, scDate, approvalDate, commercialPlanReceivedDate } }`:
     o mesmo formato do `POST /complete`.
   Sem o campo, o comportamento atual continua igual.
2. Na mesma transação do `RESTORE`, depois de `assertPoDeleted` e da checagem de versão:
   1. se a PO já tiver a mesma SC vinculada, nada muda;
   2. se já tiver outra SC vinculada, a rota responde `409 PO_ALREADY_HAS_PURCHASE_REQUEST` e nada é
      gravado;
   3. caso contrário, a SC é resolvida com `resolvePurchaseRequestForCompletePo` (cria ou reaproveita, e
      bloqueia fornecedor diferente com `409 PURCHASE_REQUEST_SUPPLIER_MISMATCH`). Depois são gravados
      `purchase_request_id`, a auditoria `PURCHASE_ORDER / UPDATE` e os campos da SC em todos os itens
      ativos, com `FOLLOWUP_UPDATE`, reaproveitando o mesmo código da rota
      `POST /:id/purchase-request`.
3. A resposta inclui `purchaseRequestId` e `purchaseRequestCreated`.
4. O detalhe da PO (`GET /api/v1/purchase-orders/:id`) passa a devolver `lastRestoredAt`,
   `lastRestoredBy` e `lastRestoreReason`, lidos do último `RESTORE` em `audit.audit_log`. Sem migration.

### Web — tela de upload (`NewOperationalRecord` + `DeletedPurchaseOrderActions`)

5. Quando a planilha encontra uma PO excluída da mesma importadora, o bloco de SC continua visível e com a
   mesma classificação (`match` / `missing` / `supplier-mismatch` / `none`).
6. "Confirmar restauração" e "Confirmar restauração com a planilha" enviam `purchaseRequest`:
   - `match`, ou SC escolhida no seletor: `{ purchaseRequestId }`;
   - `missing`: `{ newPurchaseRequest }`, com o solicitante obrigatório. Sem solicitante, o botão fica
     desabilitado e mostra uma mensagem explicando;
   - `supplier-mismatch`: o botão fica bloqueado, com o mesmo aviso do cadastro.
7. Os erros `PO_ALREADY_HAS_PURCHASE_REQUEST` e `PURCHASE_REQUEST_SUPPLIER_MISMATCH` aparecem com a
   mensagem da API.
7a. Ajuste pedido pelo usuário em 2026-10-22, porque o rótulo anterior fazia parecer que a ação tinha sido
    trocada: as ações passam a se chamar **Restaurar como estava** (reativa a PO com os itens que ela tinha)
    e **Restaurar com os dados da planilha** (reativa a PO e atualiza os itens conforme a planilha), cada uma
    com essa explicação. A confirmação diz "Confirmar restauração com a planilha". Se a prévia não tiver
    diferenças, a tela avisa que o resultado é o mesmo de restaurar como estava.

### Web — página da PO

8. O cabeçalho mostra "Criada em {data}". Quando houver restauração, mostra também
   "Restaurada em {data} por {usuário} — {motivo}".

### PO nova pela planilha (garantia de regressão)

9. O fluxo já existente (`POST /complete` com `newPurchaseRequest`, desde `83c3511`) continua criando ou
   vinculando a SC da planilha. A montagem do payload da tela passa para uma função pura testável e
   compartilhada com restaurar/substituir, para que os dois caminhos enviem a SC da mesma forma.

## Restrições

- Sem migration e sem mudar a regra da M063/M064, que exige `lifecycle_changed_*` nulo em PO `ACTIVE`.
- Reaproveitar `resolvePurchaseRequestForCompletePo`, `purchaseRequestOperationalFields`, `record`,
  `lockedPo` e `classifyTotvsPurchaseRequest`, sem duplicar as regras de SC.
- Permissões não mudam. Restaurar e substituir continuam exigindo `purchase-orders.lifecycle.manage`.
- Validação só no HML, com dados sintéticos `HMLVAL` e limpeza controlada. A `030201` real não é alterada
  pelo agente.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | Restaurar com `newPurchaseRequest` cria a SC, vincula a PO e preenche o solicitante e as datas nos itens, na mesma transação, com auditoria | API (`purchase-order-restore-sc.test.mjs`) |
| 2 | Substituir com `newPurchaseRequest` faz o mesmo que o critério 1, junto com o diff dos itens | API |
| 3 | Restaurar ou substituir com `{ purchaseRequestId }` de uma SC compatível vincula a SC e aplica os campos | API |
| 4 | SC com outro fornecedor → 409 e nada gravado (a PO continua `DELETED`) | API |
| 5 | PO excluída já vinculada a outra SC → 409 e nada gravado | API |
| 6 | Sem `purchaseRequest`, restaurar e substituir continuam iguais (regressão) | API (testes existentes) |
| 7 | `GET` da PO devolve os dados da última restauração | API |
| 8 | A tela envia `purchaseRequest` conforme a classificação e bloqueia nos casos `missing` sem solicitante e `supplier-mismatch` | Web (função pura testável) |
| 9 | Contrato web↔API das rotas alteradas | `web-route-contract.test.mjs` |
| 10 | No HML, uma PO sintética `HMLVAL` excluída e restaurada pela planilha cria a SC, que aparece no PCM com o solicitante nos itens. Ao final, a PO é excluída e a SC sintética é apagada, com as contagens conferidas | Teste opt-in HML + registro no README de deploy |
| 11 | PO nova com SC inexistente: a tela envia `newPurchaseRequest` com o solicitante, e sem solicitante o salvamento fica bloqueado. Com SC existente compatível, envia `purchaseRequestId` | Web (função pura compartilhada) |
| 12 | No HML, uma PO nova sintética `HMLVAL` criada com SC inexistente gera a SC no PCM, com o solicitante nos itens. Ao final, a PO é excluída e a SC é apagada | Teste opt-in HML |
| 13 | O usuário confere no Preview o cadastro de PO nova com SC inexistente (o agente não passa pelo SSO da Vercel) | Validação manual do usuário |

## Fora do escopo

- Corrigir a `030201` real. O usuário usa **SC da PO → Criar SC e vincular** na página da PO, que já está
  disponível, ou restaura de novo pela planilha depois da entrega.
- Trocar a SC de uma PO que já tem SC vinculada.
- Recriar a PO como um registro novo, com outro `created_at`. A unicidade `(importer, normalized_number)`
  continua, e a PO excluída é sempre restaurada.
- Guardar a data de restauração em coluna própria (exigiria migration).
- Cadastro manual sem planilha.

## Plano

1. Testes da API (critérios 1–7) e da função web (critérios 8 e 11), confirmando que falham.
2. API: schema `purchaseRequest` em restore/replace, extração do trecho "vincular SC e aplicar aos itens"
   da rota `/:id/purchase-request` para uma função comum, e `lastRestored*` no detalhe. Build e testes.
   Commit.
3. Web: classificação reaproveitada no bloco de PO excluída, payload, bloqueios e mensagens. Linha
   "Restaurada em…" na página da PO. Testes, lint, type-check e build. Commit.
4. Push para `homologacao`, conferir o Preview `Ready` e o commit.
5. Publicar a API no HML (novo release, backup do drop-in, reinício, health, rota sem sessão → 401) e rodar o
   teste opt-in sintético (critérios 10 e 12). Registrar em `deploy/hostinger/README.md`. Commit e push.
6. Avisar o usuário para validar no Preview, incluindo a vinculação da SC `020028` na `030201`.
