# Tarefa: ciclo de vida do IP — excluir, cancelar, encerrar e reativar

| Item | Valor |
|---|---|
| Data | 2026-10-22 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | Plano aguardando aprovação. Nada implementado. |

## Diagnóstico (código em `2a8d974`; banco HML ainda não conferido, ver Fase 0)

O IP já tem dois eixos de estado:

- `record_status` (M059): `DRAFT`, `ACTIVE`, `CANCELLED`. O trigger
  `procurement.check_import_process_record_status` (M059, reescrito na M061) **proíbe** sair de
  `CANCELLED` e impede um estado diferente de `ACTIVE` com distribuições ou documentos ativos.
- `lifecycle_status` (M023): `OPEN`, `CLOSED`, com `closed_at/by` e `close_reason`.

Rotas existentes em [operations.ts](../apps/api/src/operations.ts):

- `POST /api/v1/processes/:id/close` e `/reopen`: encerrar e reabrir (`processes.write`).
- `POST /api/v1/processes/:id/cancel`: cancela documentos e distribuições, apaga os vínculos
  `process_purchase_order` e encaminha cada PO (deixa sem vínculo, manda para um IP existente ou cria um IP
  `DRAFT`). Grava `logistics_status = 'CANCELLED'`.

Não existem exclusão nem reativação. Na tela ([ProcessWorkspace.tsx](../apps/web/components/ProcessWorkspace.tsx)),
encerrar e reabrir enviam um motivo automático (`automaticAuditReason`), e o cancelamento fica dentro do
cartão "POs vinculadas".

A referência é o ciclo da PO: M063/M064, `changePurchaseOrderLifecycle` em `operations.ts`,
[po-lifecycle.ts](../apps/web/lib/po-lifecycle.ts), o cartão "Ciclo da PO" em
[OperationalPoPanel.tsx](../apps/web/components/OperationalPoPanel.tsx) e a permissão
`purchase-orders.lifecycle.manage`.

## Decisões confirmadas pelo usuário (2026-10-22)

1. **Desativar = encerrar.** Reaproveita `OPEN`/`CLOSED` e as rotas `close`/`reopen`. Não há estado novo.
2. **Reativar um IP cancelado o devolve vazio.** Ele volta para `ACTIVE`/`OPEN` sem distribuições,
   documentos nem POs. O analista recarrega a invoice ou distribui de novo com o saldo atual. Nada do que o
   cancelamento liberou é recriado.
3. **Excluir só sem dependências.** A exclusão é lógica (soft delete) e só vale para IPs sem distribuições
   ativas, documentos ativos e POs vinculadas. Um IP ativo com distribuições precisa ser cancelado antes,
   para escolher o destino das POs.
4. **Reativar e restaurar só para Master/Administrador**, com a nova permissão
   `processes.lifecycle.manage`. Importação continua podendo encerrar, reabrir, cancelar e excluir.

## Objetivo

Dar ao IP o mesmo ciclo de vida da PO: excluir da lista ativa e restaurar, cancelar e reativar, encerrar e
reabrir. Tudo fica em um cartão "Ciclo do IP", com motivo obrigatório, auditoria e outbox. O cancelamento
com encaminhamento de POs continua como está.

## Requisitos

### Estados e transições

1. `record_status` passa a aceitar `DELETED`. Transições permitidas (as demais são recusadas no banco e na
   API):

   | De | Para | Ação | Condições |
   |---|---|---|---|
   | `DRAFT` | `ACTIVE` | carga da invoice (já existe) | — |
   | `DRAFT`, `ACTIVE` | `CANCELLED` | cancelar (já existe) | `OPEN` |
   | `CANCELLED` | `ACTIVE` | **reativar** | `processes.lifecycle.manage` |
   | `DRAFT`, `ACTIVE`, `CANCELLED` | `DELETED` | **excluir** | `OPEN`; sem distribuições ativas, documentos ativos ou POs vinculadas |
   | `DELETED` | estado anterior à exclusão | **restaurar** | `processes.lifecycle.manage` |

   `OPEN` ⇄ `CLOSED` (encerrar/reabrir) continua valendo só para `ACTIVE`, como hoje.
2. A exclusão grava `deleted_at`, `deleted_by`, `delete_reason` e `record_status_before_delete`. A
   restauração devolve o IP para `record_status_before_delete` (um IP cancelado e excluído volta cancelado)
   e limpa os quatro campos.
3. A reativação grava `record_status = 'ACTIVE'` e `logistics_status = NULL`, porque a constraint
   `import_process_active_logistics_status_check` não aceita um IP ativo com status logístico cancelado.
   Documentos e distribuições cancelados continuam cancelados.

### API

4. Novas rotas, no padrão de `purchaseOrderLifecycleHandler`: corpo estrito `{ reason }` (3–1000 caracteres),
   `X-Record-Version` obrigatório, transação, `record(...)` com auditoria e outbox, escopo de importadora:
   - `DELETE /api/v1/processes/:id` (`processes.write`), auditoria `SOFT_DELETE`;
   - `POST /api/v1/processes/:id/reactivate` (`processes.lifecycle.manage`), auditoria `REACTIVATE`;
   - `POST /api/v1/processes/:id/restore` (`processes.lifecycle.manage`), auditoria `RESTORE`.
5. Erros previstos (todos `409`, exceto validação):
   - `IP_HAS_DEPENDENCIES` — excluir com distribuições, documentos ou POs vinculadas. A mensagem orienta
     a cancelar o IP e encaminhar as POs;
   - `PROCESS_CLOSED` — excluir um IP encerrado (reabra antes);
   - `IP_NOT_CANCELLED` — reativar um IP que não está cancelado;
   - `IP_NOT_DELETED` — restaurar um IP que não está excluído;
   - `PROCESS_ALREADY_DELETED` — excluir de novo;
   - `400 INVALID_PROCESS_LIFECYCLE` — id ou motivo inválidos.
6. As rotas que alteram o IP continuam exigindo `ACTIVE`/`OPEN`. Revisar as checagens que hoje comparam só
   com `CANCELLED` para recusar também `DELETED`:
   - destino `EXISTING` do cancelamento (`target.rows[0].record_status === "CANCELLED"`);
   - revisão da invoice em `POST /processes/import-invoice` (`previous.record_status === "CANCELLED"`).
     Um IP excluído recebe `409 DELETED_IP_REFERENCE` com orientação para restaurá-lo.
7. `POST /api/v1/processes` com número já usado por um IP excluído da mesma importadora responde
   `409 DELETED_IP_REFERENCE` em vez de violar a unicidade de `normalized_ip_number`.
8. Leitura em [processes.ts](../apps/api/src/processes.ts):
   - `GET /api/v1/processes` esconde `DELETED` por padrão e aceita
     `recordStatus=active|draft|cancelled|deleted|all`, como o filtro `lifecycle` da carteira de POs;
   - `GET /api/v1/processes/:id` continua devolvendo o IP excluído, para a tela permitir a restauração,
     e passa a incluir `deletedAt`, `deletedBy` e `deleteReason`.
9. As consultas que já filtram `record_status = 'ACTIVE'` (saldo, candidatos de invoice, duplicidade de
   invoice) não mudam.

### Banco — `M067_import_process_lifecycle.sql`

10. Amplia o `CHECK` de `record_status` com `DELETED` e adiciona `deleted_at`, `deleted_by`,
    `delete_reason` e `record_status_before_delete`. Uma constraint garante que os quatro estão preenchidos
    se e somente se o IP está `DELETED`, com motivo de 3 caracteres ou mais.
11. Reescreve `procurement.check_import_process_record_status` com a tabela de transições do requisito 1.
    Mantém as regras atuais (nada fora de `ACTIVE` com distribuições ou documentos ativos) e acrescenta a
    recusa de `DELETED` com vínculos em `process_purchase_order`.
12. Concede ao papel da aplicação as colunas novas, no mesmo bloco `DO $$` das migrations anteriores.
13. Aplicar primeiro numa cópia restaurada e depois **somente** no HML. Não tocar na produção.

### Autorização

14. Adicionar `processes.lifecycle.manage` em [authorization.ts](../apps/api/src/authorization.ts) para
    Master e Administrador.

### Web

15. Novo [apps/web/lib/ip-lifecycle.ts](../apps/web/lib/ip-lifecycle.ts) com
    `processLifecycleActions(recordStatus, lifecycleStatus, canWrite, canManageLifecycle)`, no molde de
    `purchaseOrderLifecycleActions`:
    - `ACTIVE`/`OPEN`: encerrar, cancelar, excluir;
    - `ACTIVE`/`CLOSED`: reabrir;
    - `DRAFT`/`OPEN`: cancelar, excluir;
    - `CANCELLED`: reativar (só gestor), excluir;
    - `DELETED`: restaurar (só gestor).
16. Em `ProcessWorkspace.tsx`, criar o cartão "Ciclo do IP" com um campo "Motivo da ação" e um botão para
    cada ação permitida. Rótulos: "Encerrar IP", "Reabrir IP", "Excluir IP", "Reativar IP" e
    "Restaurar IP". Encerrar e reabrir passam a usar o motivo digitado. "Cancelar IP e encaminhar POs"
    continua com o formulário de destinos atual, mas usa o mesmo motivo. "Excluir IP" fica desabilitado,
    com explicação, enquanto houver distribuições, documentos ou POs.
17. Avisos de estado: IP excluído ("excluído da lista ativa; dados e histórico disponíveis para consulta"),
    reativado (orienta a recarregar a invoice ou distribuir de novo) e, sem gestor, "Peça a um Master ou
    Administrador para reativar/restaurar".
18. Lista de IPs ([processes/page.tsx](../apps/web/app/processes/page.tsx)): filtro de situação (ativos,
    rascunho, cancelados, excluídos, todos), preservado na URL.
19. Carga de invoice ([NewOperationalRecord.tsx](../apps/web/components/NewOperationalRecord.tsx)): um IP
    existente `DELETED` bloqueia com a mensagem de restauração, como já acontece com `CANCELLED`/`CLOSED`.
20. Compatibilidade: se a API responder `404` nas rotas novas (versão anterior), a tela mostra "Ciclo do IP
    indisponível nesta versão da API", como em `555774e` para a PO.

## Restrições

- Seguir os padrões do ciclo da PO: `BusinessError`, `problem`, `transaction`, `checkVersion`, `record` e
  respostas `{ id, recordStatus, version }`.
- Não alterar o comportamento do cancelamento com encaminhamento, da revisão de invoice nem do saldo das
  POs.
- Nunca apagar fisicamente `import_process`. O número do IP excluído continua reservado (`UNIQUE
  (normalized_ip_number)` da M001).
- Migration e testes de banco somente em cópia restaurada e no HML. Sem dados de produção.
- Não alterar variáveis da Vercel nem a configuração da VPS.

## Critérios de aceite

Cada item tem um teste automatizado.

1. Excluir um IP `ACTIVE`/`OPEN` sem dependências o torna `DELETED`, grava os quatro campos, a auditoria
   `SOFT_DELETE` e o outbox, e incrementa a versão. *(API unitário + HML)*
2. Excluir com distribuição ativa, documento ativo ou PO vinculada responde `409 IP_HAS_DEPENDENCIES` e
   nada é gravado. Excluir um IP encerrado responde `409 PROCESS_CLOSED`. *(API unitário + HML)*
3. Excluir um IP `CANCELLED` ou `DRAFT` funciona, e restaurar o devolve ao mesmo estado. *(API unitário + HML)*
4. Restaurar sem `processes.lifecycle.manage` responde `403`. Com a permissão, o IP volta ao estado
   anterior, os quatro campos ficam nulos e a auditoria `RESTORE` é gravada. *(API unitário + autorização)*
5. Reativar um IP `CANCELLED` (só gestor) deixa `ACTIVE`/`OPEN` com `logistics_status` nulo, sem
   distribuições nem POs, e grava a auditoria `REACTIVATE`. Reativar outro estado responde
   `409 IP_NOT_CANCELLED`. *(API unitário + HML)*
6. O trigger da M067 recusa as transições fora da tabela, mesmo por SQL direto. *(teste de migration +
   cópia restaurada)*
7. `GET /api/v1/processes` não lista excluídos por padrão e lista com `recordStatus=deleted|all`.
   *(API unitário)*
8. O cancelamento recusa um IP excluído como destino, a revisão de invoice recusa um IP excluído e a criação
   manual com o número de um IP excluído responde `409 DELETED_IP_REFERENCE`. *(API unitário)*
9. `processLifecycleActions` devolve as ações do requisito 15 para cada combinação de estado e papel.
   *(web unitário)*
10. As rotas novas usadas pela tela existem na API com o método e a permissão corretos. *(contrato
    `web-route-contract.test.mjs` + `api-compat.test.mjs`)*
11. `npm test`, lint, type-check e build da API e da web passam.
12. API HML no novo release, M067 só no HML e validação sintética opt-in executada com limpeza. No
    Preview, a tela mostra o cartão "Ciclo do IP", e o usuário conferiu o fluxo.

## Fora do escopo

- Recriar distribuições, documentos ou vínculos ao reativar (decisão 2).
- Excluir um IP que ainda tem distribuições, liberando-as automaticamente (decisão 3).
- Um estado "inativo" separado de encerrado (decisão 1).
- Exclusão física e reaproveitamento do número de um IP excluído.
- Mudanças no ciclo da PO, nas exportações e nos relatórios além de esconder os IPs excluídos da lista.
- Produção: promover para `main` só depois da aprovação do usuário, por PR.

## Plano

Cada fase termina com testes, lint, type-check e build passando e com um commit na `homologacao`.

### Fase 0 — conferência no HML (somente leitura)

1. Pela VPS, confirmar que a conexão aponta para `erp_po_totvs_hml` e o papel `import_erp_hml_app`, e que o
   ledger está em M001–M066.
2. Contar os IPs por `record_status` × `lifecycle_status`. Listar os `CANCELLED` com
   `logistics_status`, os `DRAFT` criados por cancelamento e os que têm vínculos em `process_purchase_order`.
3. Confirmar que nenhuma linha atual viola as constraints novas. Registrar os números neste documento.

### Fase 1 — migration M067

1. Teste primeiro: estender [invoice-migrations.test.mjs](../apps/api/test/invoice-migrations.test.mjs)
   com as asserções da M067 (CHECK, colunas, constraint de metadados, tabela de transições, grants).
2. Escrever `apps/api/migrations/M067_import_process_lifecycle.sql` e a entrada no
   [README das migrations](../apps/api/migrations/README.md).
3. Commit: `feat(ip): add deleted state and lifecycle transitions for IPs (M067)`.

### Fase 2 — API

1. Teste primeiro: `apps/api/test/process-lifecycle.test.mjs`, no estilo de
   [purchase-order-lifecycle.test.mjs](../apps/api/test/purchase-order-lifecycle.test.mjs) (Fastify com
   `client` simulado). Cobre os critérios 1 a 5, 7 e 8. Incluí-lo no script `test` da API.
2. Permissão `processes.lifecycle.manage` e caso em
   [authorization.test.mjs](../apps/api/test/authorization.test.mjs).
3. `changeProcessLifecycle` e `processLifecycleHandler` em `operations.ts`, com as três rotas.
4. Ajustes do requisito 6 (destino do cancelamento, revisão de invoice), do requisito 7 (criação manual) e
   do requisito 8 (lista e detalhe).
5. Contrato em [web-route-contract.test.mjs](../apps/api/test/web-route-contract.test.mjs).
6. Commit: `feat(ip): delete, restore and reactivate import processes`.

### Fase 3 — web

1. Teste primeiro: `apps/web/test/ip-lifecycle.test.mjs` (critério 9) e o caso de compatibilidade em
   [api-compat.test.mjs](../apps/web/test/api-compat.test.mjs).
2. `apps/web/lib/ip-lifecycle.ts`.
3. Cartão "Ciclo do IP" e avisos em `ProcessWorkspace.tsx`. Encerrar e reabrir passam a usar o motivo
   digitado.
4. Filtro de situação na lista de IPs e bloqueio de IP excluído na carga da invoice.
5. Commit: `feat(ip): IP lifecycle card, deleted filter and invoice guard`.

### Fase 4 — validação HML

1. Teste opt-in `apps/api/test/process-lifecycle-hml.integration.mjs` e script `test:ip-lifecycle:hml`,
   no molde de [purchase-order-sc-sync-hml.integration.mjs](../apps/api/test/purchase-order-sc-sync-hml.integration.mjs).
   Ele cria um IP sintético `TEST-IP-LIFECYCLE-<data>-<id>`, percorre excluir → restaurar → cancelar →
   reativar → encerrar → reabrir, confere auditoria e outbox e limpa os dados ao final.
2. Validar a M067 numa cópia restaurada (transação com rollback) e aplicá-la só no HML, com backup.
3. Publicar a API no HML (`import-erp-hml-api`), conferir o health e as rotas novas, e rodar o teste
   opt-in. Push `git push production homologacao`, acompanhar o Preview até `Ready` e conferir a tela.
4. Registrar o release, o backup e a validação em
   [deploy/hostinger/README.md](../deploy/hostinger/README.md) e atualizar o status deste documento.
5. Commit: `docs(hml): record IP lifecycle release and validation`.

## Riscos

- **Ordem do deploy:** a web nova sobre uma API antiga recebe `404` nas rotas novas; o requisito 20 cobre
  esse caso. A API nova exige a M067 antes de subir, porque o trigger antigo recusa sair de `CANCELLED`.
  Ordem: M067 → API HML → push da web.
- **Reativar um IP de invoice:** ele volta sem distribuições, e a revisão da invoice passa a tratá-lo como
  revisão de um IP `ACTIVE`, sem distribuições antigas a cancelar. Coberto no teste HML.
- **IPs `DRAFT` criados no cancelamento:** costumam ter a PO encaminhada vinculada, então a exclusão é
  recusada (`IP_HAS_DEPENDENCIES`). Para excluir, primeiro é preciso cancelar o rascunho e escolher o
  destino da PO. Isso evita deixar uma PO encaminhada sem rastro.
