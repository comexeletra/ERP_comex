# API ERP na VPS Hostinger

## Pós-embarque do IP nos produtos no HML (2026-10-23)

O commit `413fe6a` completa o plano `docs/PLANO_POS_EMBARQUE_IP_PRODUTOS.md` sobre a M068: status do IP e das
linhas calculado pelas datas (o status informado só prevalece quando é `CANCELLED`; a carga de invoice deixa de
gravar `WAITING SHIPMENT`); bloqueio de datas efetivas fora de ordem (`IP_DATE_SEQUENCE_INVALID`) com avisos para
os demais casos; confirmação com justificativa digitada para criar, mudar a quantidade, cancelar distribuição ou
revisar invoice em IP com BL date ou Departure (`IP_ALREADY_SHIPPED_UNCONFIRMED`); carteira por produto
(`GET /api/v1/purchase-order-lines`) e sua exportação (`POST /api/v1/exports/purchase-order-lines`, job
`purchase-order-lines-xlsx`); lista de IPs e relatório de pós-embarque pelo status calculado. Não houve migration;
o ledger HML segue em M001–M068.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-413fe6a` a partir de `git archive`,
reaproveitando o `node_modules` de `hml-release-c050193` (dependências inalteradas), e ativado pelo drop-in
`zzzzzzzzzzzzzzzzzz-release-413fe6a.conf`. O drop-in e o `ExecStart` anteriores estão em
`/var/backups/import-erp/hml-post-shipment-413fe6a-predeploy`. Para rollback somente do código, remova o drop-in
novo, execute `systemctl daemon-reload` e reinicie `import-erp-hml-api` (volta a `hml-release-c050193`).
`/health/live` responde 200; `GET /api/v1/purchase-order-lines` e `POST /api/v1/exports/purchase-order-lines` sem
sessão respondem 401.

O teste opt-in `apps/api/test/post-shipment-propagation-hml.integration.mjs` (`npm run test:post-shipment:hml`)
passou no release, com a role `import_erp_hml_app` (run `D07A6BC4665F`): duas POs divididas entre dois IPs
mostraram BL, ETD, ETA e status de cada IP nas parcelas certas; editar o IP não gravou os itens das POs; datas
impossíveis e mudança não confirmada em IP embarcado foram recusadas; o filtro de status da carteira por produto
selecionou exatamente as linhas com o status calculado pela API; a lista de IPs devolveu o mesmo status do
acompanhamento. Ao final, as 3 distribuições e a invoice foram canceladas e os 2 IPs e as 2 POs sintéticos ficaram
`DELETED` (a auditoria é append-only); o HML terminou sem distribuições nem IPs ativos. O push de `homologacao`
para `413fe6a` recebeu status Vercel `success`.

O worker isolado de homologação `import-erp-hml-export-worker` foi instalado pelos commits `05729d9` e `305b1c5`.
Ele usa `/etc/import-erp/homologation-db.env`, valida em todo start que o banco é `erp_po_totvs_hml` e executa
`hml-release-413fe6a/dist/worker.js` pelo drop-in `release-413fe6a.conf`. A unit base usa `/usr/bin/false`, portanto
não inicia sem um drop-in de release; o instalador também recusa um SHA diferente do release efetivo da API HML.
O serviço ficou `active` em 2026-10-23 às 09:17:45 de Brasília e o journal registrou `export_worker_started`.

O job `purchase-order-xlsx` parado desde 2026-10-23 11:55 UTC terminou `completed` com uma linha. O teste opt-in
`test:export-worker:hml` criou um job `purchase-order-xlsx` e outro `purchase-order-lines-xlsx`; ambos terminaram
`completed` com binário iniciado por `PK`, e o teste apagou os dois registros ao final. A fila terminou sem jobs
pendentes. O worker de produção permaneceu `active` com o mesmo `ActiveEnterTimestamp` de 2026-10-19 20:38:54
de Brasília; `import-erp-export-worker`, `api.env`, as variáveis da Vercel e o banco de produção não foram alterados.

Em cada release HML seguinte, ative primeiro o novo drop-in da API e depois execute
`enable-homologation-export-worker.sh <sha>`. O script exige que a API já esteja no mesmo `hml-release-<sha>`,
troca o drop-in do worker, reinicia somente o worker HML e confirma `is-active` e `export_worker_started`. Confira
também o health da API, execute `test:export-worker:hml` e verifique que o worker de produção manteve seu
`ActiveEnterTimestamp`. Para rollback do serviço HML, execute
`systemctl disable --now import-erp-hml-export-worker`, remova a unit e o diretório
`import-erp-hml-export-worker.service.d`, e execute
`systemctl daemon-reload`. Nenhuma reversão de banco é necessária; um job interrompido volta à fila após o lease.

## BL nº e BL date no IP (M068) no HML (2026-10-23)

O commit `c050193` move BL nº e BL date para o IP (um IP é um embarque): o formulário de Pós Embarque passa a ter
os dois campos, todos os produtos do IP leem os mesmos valores e a API deixa de criar ou editar documentos BL
(`BL_IS_IP_FIELD`), que ficam como histórico.

Antes da migration, o HML `erp_po_totvs_hml` estava em M001–M067, com 3 IPs, 9.298 linhas de auditoria, 7.789
mensagens outbox e nenhum documento BL. O backup custom pré-M068 foi validado com `pg_restore --list` (429 entradas):
`/var/backups/import-erp/erp_po_totvs_hml_m068_20261023T000419Z.dump`, 466.384.082 bytes, SHA-256
`a6224b371785ddfe0e4d87eaa3b864cc2faf49b0c2189f628acf21c40f105bab`. A M068 foi validada na cópia restaurada
`erp_po_hml_m068_check_20261023T000639Z`, em transações revertidas: um BL ativo preencheu o IP (número aparado,
data copiada, uma linha de auditoria `migration:M068`, documentos intactos, BL cancelado ignorado), dois BLs
diferentes no mesmo IP bloquearam a migration, e BL nº em branco foi rejeitado. A aplicação completa na cópia
levou o ledger a M068 sem alterar contagens; a cópia foi removida.

M068 foi aplicada somente no HML, como `postgres` dentro do container, com checksum
`e254213045a7af05748afda34b9e1adecc4954e0e9d3503a9499387ff9aabbf5`. O ledger passou a M001–M068; IPs, auditoria e
outbox mantiveram 3, 9.298 e 7.789 registros.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-c050193` a partir de `git archive`
(fontes em LF), reaproveitando o `node_modules` de `hml-release-0a7df01` (dependências inalteradas), e ativado pelo
drop-in `zzzzzzzzzzzzzzzzz-release-c050193.conf`. O drop-in e o `ExecStart` anteriores estão em
`/var/backups/import-erp/hml-post-shipment-bl-c050193-predeploy`. Para rollback somente do código, remova o drop-in
novo, execute `systemctl daemon-reload` e reinicie `import-erp-hml-api` (volta a `hml-release-0a7df01`); a M068
deve permanecer aplicada. `/health/live` responde 200 e `PATCH /api/v1/processes/:id/followup` e
`POST /api/v1/processes/:id/documents` sem sessão respondem 401. O push de `homologacao` para `c050193` recebeu
status Vercel `success`. Nenhuma produção foi alterada; a produção (`erp_po_totvs_test`) segue em M034 e só foi
lida, com autorização do usuário, para contagens agregadas.

## Ciclo de vida do IP no HML (2026-10-22)

O commit `0a7df01` publica as rotas de exclusão lógica, restauração e reativação de IP, com filtro de
excluídos, motivo obrigatório, controle de versão, auditoria e outbox. A M067 foi validada primeiro no
backup restaurado `erp_po_hml_m067_check_20261022T214553Z_23847`: o DDL, os grants e as transições
ACTIVE/CANCELLED/DELETED/CLOSED passaram dentro de uma transação revertida, e a cópia foi removida.

Antes da migration, o banco HML `erp_po_totvs_hml` estava em M001–M066, role runtime
`import_erp_hml_app`, com 2 IPs e todos os pré-checks em zero. O backup custom pré-M067 foi validado com
`pg_restore --list`: `/var/backups/import-erp/erp_po_totvs_hml_m067_20261022T214553Z.dump`,
466.346.973 bytes, SHA-256 `1e4513d391603db24b8a06037434a44b208731ab3b234d662136c2f9768b692a`.
M067 foi aplicada somente no HML com checksum `74fc6bee7a57261260d1f085208e02a1bae925249e176b957352d2a3442c77b4`;
o ledger passou a M001–M067. A aplicação usou `psql` como `postgres` dentro do container PostgreSQL,
após confirmar o alvo; o `migration-release.env` não foi usado porque aponta para `/erp_po_totvs_test`.
Nenhuma conexão foi feita a esse outro banco.

O serviço `import-erp-hml-api` está ativo em `/opt/import-erp/apps/api/hml-release-0a7df01/dist/server.js`,
pelo drop-in `/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzzzzzzzzzz-release-0a7df01.conf`.
O predeploy do release anterior está em `/var/backups/import-erp/hml-ip-lifecycle-0a7df01-predeploy`.
Para rollback somente do código, remova o drop-in `0a7df01`, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`; o release anterior preservado é `hml-release-5e8b0e3`. M067 deve permanecer aplicada.
O health responde 200 e `POST /api/v1/processes/:id/reactivate` sem sessão responde 401.

O teste opt-in `apps/api/test/process-lifecycle-hml.integration.mjs`
(`pnpm run test:ip-lifecycle:hml`) passou com a role `import_erp_hml_app`. O IP sintético
`TEST-IP-LIFECYCLE-20261022-E3176DD8A5524FC4` percorreu excluir → restaurar → cancelar → reativar →
encerrar → reabrir e terminou `DELETED`/`OPEN`, sem PO, documento ou alocação vinculados. Foram verificados
8 registros de auditoria e 8 mensagens outbox. Para respeitar a auditoria append-only, o registro permanece
como tombstone excluído e fora da lista ativa. O HML ficou com 3 IPs (1 ACTIVE, 1 CANCELLED e 1 DELETED),
9.296 linhas de auditoria e 7.787 mensagens outbox; a migration não alterou essas contagens.

O push de `homologacao` para `0a7df01148fc3e59a5e7582cf4a223f054be81b6` recebeu status Vercel `success`
(“Deployment has completed”) na [execução do Preview](https://vercel.com/eletra-comex/erp-comex/EvsmyTgBXK5fTSsBVtuLfM7Sp7uX).
O alias estável `https://erp-comex-git-homologacao-eletra-comex.vercel.app` responde 302 para
`vercel.com/sso-api`; por isso, a tela não pôde ser validada visualmente pelo agente. Nenhuma produção foi
consultada ou alterada.

## Dados da SC editados na PO sincronizados com o PCM no HML (2026-10-22)

O commit `a71ed42` faz `PATCH /api/v1/purchase-orders/:id/items/followup` e
`PATCH /api/v1/purchase-orders/:id/complete` atualizarem a SC vinculada quando
data da SC, aprovação, solicitante ou recebimento do plano comercial são
alterados na PO. A atualização é feita na mesma transação, com auditoria
`PURCHASE_REQUEST / UPDATE`, e propaga para as outras POs da SC pela mesma regra
do PCM (função `syncPurchaseRequestItems`, agora comum às duas rotas). Também:
- o número da SC fica bloqueado (`PURCHASE_REQUEST_NUMBER_LOCKED`);
- o solicitante não pode ficar vazio;
- salvar a PO mantém os valores editados, em vez de sobrescrevê-los com os da SC;
- a edição por item não pode divergir da SC (`PURCHASE_REQUEST_FIELDS_SHARED`).

Não houve migration; o ledger HML segue em M001–M066.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-a71ed42`,
com as fontes do `git archive` normalizadas para LF antes do build (`src` e
`dist` sem CR), e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzzzzzzzz-release-a71ed42.conf`.
O drop-in e o `ExecStart` anteriores (`hml-release-1104ee1`) foram preservados em
`/var/backups/import-erp/hml-po-sc-sync-a71ed42-predeploy`. Para reverter,
remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`. Ignorando CR, o `dist` difere do release anterior em
`followup.js`, `operations.js` e `purchase-requests.js`. O serviço está
`active`, `/health/live` respondeu 200 e `items/followup` sem sessão respondeu 401.

Correção do registro anterior: o release `hml-release-1104ee1` foi compilado com
fontes em CRLF, porque o `git archive` desta máquina aplica a conversão de fim de
linha. O funcionamento não foi afetado, e a validação daquele release passou.
Daqui em diante, normalize as fontes para LF (`sed -i 's/$//'`) antes do build.

O teste opt-in `apps/api/test/purchase-order-sc-sync-hml.integration.mjs`
(`npm run test:po-sc-sync:hml`) foi executado com a role `import_erp_hml_app`.
Ele criou a SC sintética `HMLVAL-SC-SYNC-B8AB7695FEA74C87` com duas POs, aplicou
data da SC e aprovação pela primeira PO e conferiu a SC no PCM, os itens das duas
POs e uma auditoria `UPDATE`. Também confirmou o bloqueio do número da SC. Ao
final, as duas POs ficaram `DELETED` e a SC foi apagada.

A pedido do usuário (fase de testes), a SC `020028` da PO `030201` foi
preenchida no HML pela rota `PATCH /api/v1/purchase-requests/:id`, com os valores
que já estavam nos 215 itens: data da SC 2026-10-01, aprovação 2026-10-05 e plano
comercial 2026-10-11. O ator foi `hml-maintenance#agent-fill-sc-020028`, e a SC
passou da versão 1 para a 2. Os itens não mudaram. Depois disso, o HML ficou com
2 SCs, 12 POs (11 `DELETED`) e 446 itens. O Preview Vercel do commit está com
status `success`. Nenhuma produção foi consultada ou alterada.

## SC ao restaurar ou substituir PO excluída no HML (2026-10-22)

O commit `1104ee1` faz `POST /api/v1/purchase-orders/:id/restore` e
`POST /api/v1/purchase-orders/:id/replace` aceitarem o campo opcional
`purchaseRequest` (`{ purchaseRequestId }` ou `{ newPurchaseRequest }`). A SC é
vinculada ou criada na mesma transação da restauração, e o solicitante e as datas
vão para os itens. `GET /api/v1/purchase-orders/:id/operational` passa a devolver
`createdAt` e `lastRestore`, este lido de `audit.purchase_order_operational_history`.
Não houve migration; o ledger HML segue em M001–M066.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-1104ee1`,
a partir de `git archive` do commit (fontes em LF), e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzzzzzzz-release-1104ee1.conf`.
O drop-in e o `ExecStart` anteriores (`hml-release-58dda50`) foram preservados em
`/var/backups/import-erp/hml-po-restore-sc-1104ee1-predeploy`. Para reverter o
código, remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`. Ignorando CR, o `dist` difere do release anterior somente
em `operations.js`. O serviço está `active`, `/health/live` respondeu 200 por
HTTPS e `restore` sem sessão respondeu 401.

O teste opt-in `apps/api/test/purchase-order-restore-sc-hml.integration.mjs`
(`npm run test:po-restore-sc:hml`) foi executado no release com a role
`import_erp_hml_app` em `erp_po_totvs_hml`. Ele cobriu três cenários: PO nova
`HMLVAL-PO-NEWSC-720DFCF1B1184813` criada com SC inexistente; restauração de
`HMLVAL-PO-RESTSC-720DFCF1B1184813` com SC nova; e substituição da mesma PO pela
planilha com outra SC nova. Em todos, a SC foi listada no PCM e o número, o
solicitante e a data da SC ficaram nos itens. A página da PO devolveu a última
restauração. Ao final, as POs ficaram `DELETED`, sem SC, e as três SCs sintéticas
foram apagadas.

Após a validação, o HML ficou com 1 SC, 10 POs (9 `DELETED`), 444 itens e
1 alocação. A PO `030201` de ELETRA INDUSTRIA não foi alterada: continua ativa,
na versão 7 e sem SC, aguardando a vinculação da SC `020028` pelo usuário. O
Preview Vercel do commit está com status `success` ("Deployment has completed").
O domínio estável responde 302 para o SSO da Vercel, então a interface não foi
validada pelo agente. Nenhuma produção foi consultada ou alterada.

## Criar e vincular SC numa PO existente no HML (2026-10-21)

O commit `58dda50` publica `POST /api/v1/purchase-orders/:id/purchase-request`
(permissão `purchase-orders.write`). Para PO ativa sem SC, a rota cria ou
reaproveita a SC pela importadora e pelo fornecedor da PO, vincula-a e aplica os
campos da SC a todos os itens, com auditoria. Também corrige duas mensagens de
SC salvas com acentuação corrompida. Não houve migration; o ledger HML segue em
M001–M066.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-58dda50`,
com as fontes normalizadas para LF, e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzzzzzz-release-58dda50.conf`.
O drop-in e o `ExecStart` anteriores (`hml-release-b411567`) foram preservados em
`/var/backups/import-erp/hml-po-sc-link-58dda50-predeploy`. Para rollback do
código, remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`. Ignorando CR, o `dist` difere do release anterior somente
em `followup.js` e `operations.js`. O serviço ficou ativo, `/health/live`
respondeu 200 e a rota nova sem sessão respondeu 401.

O teste opt-in `apps/api/test/purchase-order-sc-link-hml.integration.mjs`, com
contexto do papel Compras e a role `import_erp_hml_app`, criou a PO sintética
`HMLVAL-PO-SCLINK-53E67256157A47F2` sem SC. Em seguida, criou e vinculou a SC
`HMLVAL-SC-LINK-53E67256157A47F2`, conferiu número, solicitante e data da SC no
item, confirmou a recusa de uma segunda vinculação, excluiu a PO logicamente e
apagou a SC pela rota de SC. O HML ficou com 8 POs, 442 itens, 1 SC e
1 alocação. As POs `030201` não foram alteradas; a de ELETRA INDUSTRIA continua
ativa e sem SC, aguardando a vinculação pelo usuário. Nenhuma produção foi
consultada ou alterada.

## Restaurar ou substituir PO excluída no HML (2026-10-21)

O commit `b411567` publica a pré-validação com os dados da PO excluída na mesma
importadora e as rotas `POST /api/v1/purchase-orders/:id/replace/preview` e
`POST /api/v1/purchase-orders/:id/replace` (permissão
`purchase-orders.lifecycle.manage`). Não houve migration; o ledger HML segue em
M001–M066.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-b411567`,
com as fontes normalizadas para LF, e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzzzzz-release-b411567.conf`.
O drop-in e o `ExecStart` anteriores (`hml-release-83c3511`) foram preservados em
`/var/backups/import-erp/hml-po-replace-d890468-predeploy`. Para rollback do
código, remova os drop-ins `zzzzzzzzzz-release-d890468.conf` e
`zzzzzzzzzzz-release-b411567.conf`, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`. Ignorando CR, o `dist` difere do release anterior somente
em `operations.js` e `purchase-orders.js`. O serviço ficou ativo, `/health/live`
respondeu 200 e as rotas novas sem sessão responderam 401.

O primeiro release (`d890468`) falhou na validação: a atualização de linha
reativada ou com produto trocado retornou `42P08` (tipo inconsistente do
parâmetro `$2`). A transação foi revertida e a PO sintética
`HMLVAL-PO-REPLACE-EEA323AB955B4FD5` permaneceu `DELETED` na versão 3, com os
itens originais. A correção foi publicada em `b411567`.

O teste opt-in `apps/api/test/purchase-order-replace-hml.integration.mjs` foi
executado no release `b411567` com a role `import_erp_hml_app` em
`erp_po_totvs_hml`. Ele criou a PO sintética
`HMLVAL-PO-REPLACE-0D2C08C3977D4B64`, removeu uma linha, excluiu a PO, conferiu
a prévia (1 atualizada, 1 incluída, 1 removida, 1 reativada e 1 com produto
trocado), aplicou a substituição numa única transação com auditoria `RESTORE` e
outbox na mesma quantidade da auditoria e, ao final, excluiu a PO logicamente.
As alocações não mudaram. Após as duas execuções, o HML tem 7 POs (as duas
sintéticas `DELETED`), 441 itens e 1 alocação. As POs `030201` não foram
alteradas. Nenhuma produção foi consultada ou alterada.

## SC junto com PO e exclusão de SC no HML (2026-10-21)

O código da Parte A e da Parte B foi publicado na branch `homologacao` no commit
`83c35117045be3abc18212bab23db6df50dc931d`. Antes da migration, o banco
`erp_po_totvs_hml` estava em M065, com 1 SC, 4 POs, 431 itens, 1 alocação,
8.534 eventos de auditoria e 7.024 mensagens de outbox.

O backup pré-M066 foi validado com `pg_restore --list` e restaurado em uma cópia
descartável: `/var/backups/import-erp/erp_po_totvs_hml_m066_20261022T001454Z.dump`,
466.238.795 bytes, SHA-256
`14ea3841ba4e6d3b32cdb92f6eae0c1a535dbd70688178e8c2b5a19cbf0ac5a3`. A cópia
`erp_po_hml_m066_copy_20261022001454` recebeu M066 e passou
`deploy/hostinger/validate-m066-on-copy.sql`: o trigger permitiu limpar somente
`purchase_request_id` de PO `DELETED`, recusou essa limpeza junto com alteração
do fornecedor, recusou alteração de negócio sem limpar o vínculo e reverteu os
testes. A cópia foi removida. O checksum M066 é
`17300c5eb50f6a6e5bc3388f3e0d6182a67cc7be343dad641c60eeea8160c433`.

M066 foi aplicada somente a `erp_po_totvs_hml`; o ledger ficou em M001–M066 e
as contagens permaneceram iguais às anteriores à migration. A role
`import_erp_hml_app` tem `DELETE` na tabela de SC e leitura da view de histórico.
Nenhuma produção foi consultada ou alterada.

A API HML está no release
`/opt/import-erp/apps/api/hml-release-83c3511`, pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzzz-release-83c3511.conf`.
O release anterior `hml-release-114fc1d`, o drop-in anterior e as instruções de
rollback estão preservados em
`/var/backups/import-erp/hml-sc-m066-83c3511-predeploy`. Para reverter somente
o código, remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`; mantenha M066 aplicada. O serviço está `active`, o health
HTTPS respondeu 200 e o readiness sem sessão respondeu 401.

O teste opt-in `apps/api/test/purchase-request-hml.integration.mjs` foi
executado na API HML com a role de runtime e contexto sintético. Ele criou uma
PO/SC `HMLVAL`, confirmou o bloqueio enquanto a PO estava ativa, excluiu a PO
logicamente, desvinculou a PO e apagou a SC pela rota nova. O histórico DELETE
ficou legível após a exclusão, e o mesmo número de SC pôde ser cadastrado e
excluído novamente. A PO sintética
`HMLVAL-PO-M066-B281E4F8F9C34CA4BF0A6DF51DF8C63B` permanece `DELETED`, sem SC,
para preservar a auditoria/outbox; a SC sintética foi removida.

Após o fluxo, HML ficou com 1 SC, 5 POs, 432 itens, 1 alocação, 8.543 eventos de
auditoria e 7.033 mensagens de outbox. As observações de preço permaneceram em
215; a observação de descrição TOTVS passou de 215 para 216 por causa do item
sintético retido com a PO excluída.

O deployment Preview Vercel do commit `83c35117045be3abc18212bab23db6df50dc931d`
está `READY` na branch `homologacao`, em
`https://erp-comex-5xedg1toc-eletra-comex.vercel.app`. O domínio estável
`https://erp-comex-git-homologacao-eletra-comex.vercel.app` responde 302 para a
proteção SSO da Vercel; por isso a interface no browser não foi validada.
Nenhuma configuração da Vercel foi alterada.

## POs excluídas fora da checagem de duplicidade no HML (2026-10-21)

O commit `114fc1d` faz a pré-validação e a criação de PO desconsiderarem POs com
`lifecycle_status='DELETED'` ao procurar números duplicados. Uma PO excluída na
mesma importadora continua bloqueando a criação (`PO_NUMBER_DELETED_IN_IMPORTER`),
pois a unicidade `(importer, normalized_number)` permanece; a orientação é
restaurá-la. Não houve migration.

O release foi compilado na VPS como `/opt/import-erp/apps/api/hml-release-114fc1d`
e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzzz-release-114fc1d.conf`.
O drop-in anterior e o `ExecStart` efetivo foram preservados em
`/var/backups/import-erp/hml-po-deleted-duplicates-114fc1d-predeploy`; para
rollback, remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api` (volta ao `hml-release-6a18999`). Ignorando CRLF, o código
difere do release anterior somente em `operations.ts` e `purchase-orders.ts`.

O serviço ficou ativo, `/health/live` respondeu 200 por HTTPS e a pré-validação
sem sessão respondeu 401. A função de validação do release foi executada contra
`erp_po_totvs_hml`, papel `import_erp_hml_app`, em transação somente leitura com
rollback: a PO `030201` em `ELETRA CURITIBA` passou da checagem de duplicidade
(a PO homônima de `Eletra Cwb` está excluída) e a PO sintética excluída
`HMLVALMVIIAQ73B9DD951D-CREATE` bloqueou a recriação na mesma importadora.
Nenhum dado foi gravado.

## Validação das regras de criação de PO no HML (2026-10-21)

O commit `6a18999` foi compilado na VPS como
`/opt/import-erp/apps/api/hml-release-6a18999` e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzzzzz-release-6a18999.conf`.
Antes da troca, o release e o drop-in anteriores foram preservados em
`/var/backups/import-erp/hml-po-validation-6a18999-predeploy` para rollback.
O serviço ficou ativo e `https://api-hml.72-60-250-212.sslip.io/health/live`
respondeu 200.

As rotas autenticadas foram exercitadas somente em `erp_po_totvs_hml`, com o
papel `import_erp_hml_app`: pré-validação de duplicidade e valores ausentes;
recusa de importadora sem CNPJ e de UM/CC inválidos; criação de uma PO sintética;
reimportação com diff vazio e alteração de quantidade; remoção de item; e troca
de importadora por Master sem alocação ativa. A PO de teste
`HMLVALMVIIAQ73B9DD951D-CREATE` ficou excluída logicamente para preservar os
eventos de auditoria/outbox; ela tem sete eventos de auditoria e sete mensagens
de outbox. A observação de descrição criada pela trigger foi removida somente
para essa PO, e o preço zero não criou observação de preço. A credencial local
temporária foi restaurada ao hash e metadados anteriores, e a sessão de teste
foi revogada.

A PO preexistente `030201` permaneceu inalterada. As contagens do HML passaram
de 2 POs e 215 itens para 3 POs e 216 itens devido à PO sintética excluída
logicamente; as alocações ativas não mudaram. O check Vercel associado ao commit
`6a18999` está `success`, mas o domínio estável do Preview responde HTTP 302
para `vercel.com/sso-api`, então a interface web não foi validada.

## Release de ciclo de vida de PO no HML (2026-10-21)

O commit `5165ca7` foi compilado na VPS como
`/opt/import-erp/apps/api/hml-release-5165ca7` e ativado pelo drop-in
`/etc/systemd/system/import-erp-hml-api.service.d/zzzz-release-5165ca7.conf`.
Antes da troca, o build `hml-release-94699c5` foi copiado e conferido em
`/var/backups/import-erp/hml-release-94699c5-po-lifecycle-20261021T115232Z`;
o drop-in anterior também está preservado nesse diretório. Para rollback, mova o
drop-in `zzzz-release-5165ca7.conf` para o backup, execute
`systemctl daemon-reload` e reinicie `import-erp-hml-api`.

A compilação e a suíte completa da API passaram. Após a troca, o serviço ficou
`active`, o readiness autenticado respondeu 200, o health público respondeu
200 e o readiness público sem token respondeu 401. A conexão confirmou
`erp_po_totvs_hml`, papel `import_erp_hml_app` e ledger M001–M063 (63/63).

As transições foram exercitadas nos handlers reais com uma PO temporária de
teste (`TEST-LIFECYCLE-20261021-5cf25df1`, id
`8edca089-7806-4b96-bcde-13f6aee35ca6`): ACTIVE → CLOSED → ACTIVE → CANCELLED →
DELETED. A PO de teste ficou excluída logicamente para preservar auditoria e
outbox, sem alocações ativas, e não aparece na lista padrão. A PO preexistente
`030201` permaneceu ACTIVE e sem alocações ativas.

## M063 — ciclo de vida de PO no HML (2026-10-20)

M063 foi aplicada somente a `erp_po_totvs_hml`, que estava em M062. Antes da
aplicação, o backup
`/var/backups/import-erp/erp_po_totvs_hml_m063_20261021T001917Z.dump` foi
verificado e restaurado em uma base descartável. A migration passou na cópia,
incluindo os gatilhos de transição e bloqueio de alterações para POs fechadas.
Após a aplicação, o ledger ficou em 63/63, sem pendências; as contagens
permaneceram em 1 PO, 215 itens, 1 alocação e 2 IPs, com 0 alocações ativas.
O backup foi verificado com `pg_restore --list`; SHA-256:
`1b3620cc3a7da676f1b9479e29c100729a886d3dcf1e2615d8ebe1dd097e3a6a`.
Os bancos `erp_po_totvs_test` e `erp_po_totvs_gatewayflow_20261010_test` não
foram alterados.

## Release M032-M034: exportacao Excel em fila (2026-10-15)

A tela ja mostrava a exportacao Excel, mas a VPS ainda estava na API M031:
o ledger tinha 31 migrations, a tabela da fila nao existia e o worker nao estava
instalado. O commit `f3b1e04` aplicou as migrations M032-M034 e publicou a API e
o servico `import-erp-export-worker`.

Antes do release, o backup
`/var/backups/import-erp/erp_po_totvs_test_20261015T012857Z.dump` foi restaurado
em uma base descartavel. M032-M034 passaram na copia, incluindo grants da role
da API e comparacao das contagens de processos, POs, itens e pendencias. SHA-256
do backup: `d869ae9953db3a7fca55a23b69c1cbfb619d56195d088986fa913f877fffd8e7`.

Verificacao apos a publicacao: ledger 34/34; `import-erp-api` e
`import-erp-export-worker` enabled/active; health live 200, ready 200 autenticado
e 401 sem token; rota protegida responde 401 sem sessao de usuario. O worker
iniciou sem erro e a geracao foi reaberta com ExcelJS como `.xlsx`. O codigo da
API anterior foi preservado em
`/var/backups/import-erp/m032-api-20261015T012904Z`.

## Paridade de migrations e base vazia de homologação (2026-10-15)

Os bancos da plataforma usam o mesmo ledger de migrations. `erp_po_totvs_test`
está em M001–M034; o banco de testes
`erp_po_totvs_gatewayflow_20261010_test` foi atualizado de M031 para M034; e a
base nova `erp_po_totvs_hml` foi criada em M001–M034 a partir das migrations
instaladas na VPS. A homologação não foi restaurada do operacional. Após aplicar
as migrations, os valores padrão inseridos nos catálogos foram removidos; todas
as tabelas de aplicação estão vazias, exceto pelo ledger
`migration.schema_migration`.

O runtime da homologação usa a role isolada `import_erp_hml_app`, que não recebe
grants nos esquemas do banco operacional. A configuração fica em
`/etc/import-erp/homologation-db.env` (root:import-erp, modo 0640); ela aponta
para o banco local e usa o listener da API na porta 4001 quando esse serviço for
ativado. O frontend/Preview ainda não foi
direcionado à API de homologação.

Para validar os ledgers e confirmar que a homologação continua vazia, rode
`verify-homologation-db.sh`. Para criar uma homologação nova em um cluster, use
`create-homologation-db.sh`; o script recusa nomes, roles ou arquivos de ambiente
que já existam e exige o operational ledger alinhado ao diretório de migrations.
Após qualquer nova migration, aplique-a a cada banco ERP isolado e confira a
paridade antes de liberar os testes.

## M031 Group (2026-10-08)

`release-m031.sh` verified a restorable backup, applied M031 to a disposable
restore, checked the four seeded `GROUP` values, then applied M031 to the
operational `erp_po_totvs_test` database. The ledger is 31/31 and the API service
remained active. Backup:
`/var/backups/import-erp/erp_po_totvs_test_20261008T184649Z.dump`; SHA-256:
`b5ee5a80e96fb4a76a724060259864279811d94e3d02f4dc0a475a47cd539400`.
`release-m031-api.sh` installed the matching catalog API change and passed the
live/ready health checks. The previous API files are in
`/var/backups/import-erp/m031-api-20261008T210946Z`. Vercel Production marked
commit `726f82d` READY and assigned the `fup-comex-eletra.vercel.app` alias.

> As seções de release abaixo registram histórico. O estado atual dos bancos está descrito no início deste arquivo; confira todos os ledgers antes de qualquer release futuro.

## Release M022–M024: histórico PO/IP e pós embarque (2026-10-06)

M022–M024 passaram em cópia restaurada do banco operacional. A cópia reteve os
grants de runtime, preservou a contagem das linhas históricas e passou
`operations.integration.mjs` e `followup.integration.mjs`, incluindo divisão de
PO entre IPs, IP compartilhado por POs, documentos, datas independentes, limites
de quantidade, concorrência, edição, cancelamento e histórico.

Backup anterior ao release: `/var/backups/import-erp/erp_po_totvs_test_20261006T134207Z.dump`, SHA-256
`34b3254c0ff3f1e8da1bddc3b3c409755a364086b20962f95b4056fbd0fe3eaf`.
O ledger ficou em 24/24. O serviço `import-erp-api` está enabled/active; health
local: `/health/live` 200, `/health/ready` 401 sem token e 200 autenticado. A rota
`GET /api/v1/processes/:id/followup` foi verificada sem sessão e respondeu 401,
confirmando que não retorna mais 404. O arquivo M021 também foi instalado junto
às definições M022–M024 para manter o status do ledger auditável na VPS.

O código anterior da API foi preservado em
`/var/backups/import-erp/m024-api-20261006T134214Z`. A Vercel marcou o commit
`49fd6fc85390` como `READY` (`dpl_9Z35Ht6jqM5p2QRtanWMQRdQ67i5`) e moveu o alias
`https://fup-comex-eletra.vercel.app` para esse deployment. O backup validado
antes da publicação está listado acima; não houve alteração na carga de dados
históricos.

## Release M025: datas de saída da fábrica por alocação PO–IP (2026-10-06)

M025 moves factory departure from a shared PO-item input to the individual PO-item/IP allocation. It does not update allocation quantities, active balances, or historical source rows. Existing item-level factory dates remain stored and appear as unassigned legacy references; the API does not copy them to multiple IPs.

`validate-m025-on-copy.py` verified a restorable backup, applied M025 only to a disposable restore, confirmed source-row counts and active allocation totals were unchanged, and passed both PostgreSQL integration contracts. The operational ledger is 25/25.

`release-m025.sh` applied the additive migration and installed the matching API. `import-erp-api` is enabled/active; local health is live 200, unauthenticated ready 401, authenticated ready 200. Public `/health/live` returned 200 and `/health/ready` returned 401 without a token. The prior API version is preserved for code rollback; M025 remains applied if rollback is needed.

Vercel marked the release `READY` and assigned the production alias.

## Release M026: itens da PO e saldos por IP

M026 promotes each existing PO line to an item in the PO workspace. It retains the line quantity and status, and records an allocation only when a matching linked IP exists. Lines without a linked IP retain their balance; canceled items keep a zero distributable balance. The original immutable records and existing manually entered items remain intact. The restored-copy validator checks item/source identity, per-IP quantities, canceled and unallocated balances, existing allocations and the PO/IP integration contracts before the production release.

The PO portfolio summary reads item and active-allocation counts from the operational item tables. `release-api-m026-followup.sh` validates a restored database copy and updates only the API code when this summary changes; it requires M026 in the ledger and keeps the previous API available for rollback.

## Release M021: valores selecionáveis e campos operacionais (2026-10-05)

M021 passou na validação em cópia restaurada, preservou as linhas históricas e
confirmou os grants do runtime. Backup verificado:
`/var/backups/import-erp/erp_po_totvs_test_20261005T131658Z.dump`, SHA-256
`3c9c88038efa01a52f986bc8418338e0f3ff6896a31732a0125a67d07cf80c26`.
O ledger operacional ficou em 21/21 e o catálogo contém 149 valores iniciais.

Depois, `release-m021-api.sh` instalou a API compilada com troca controlada e
rollback. O código anterior está preservado em
`/var/backups/import-erp/m021-api-20261005T134442Z`. `import-erp-api` ficou
`active`; `/health/ready` autenticado respondeu 200 e o build ativo contém a
rota `operational-values`. A M021 permanece aplicada caso seja necessário
reverter somente o código. O procedimento é repetível com o staging preparado
em `/tmp/erp-m021-api-release` e conferido pela `verify-api-ready.sh`.

O commit `ed1fc25` contém a interface e as rotas para os campos selecionáveis.
Criação de PO continua restrita aos perfis Master, Administrador, Importação e
Compras; ajuste de perfil deve ser feito por um Master quando necessário.

## Release M019–M020: campos e cálculos da PO (2026-10-04)

`release-m020.sh` criou backup verificável, restaurou uma cópia, aplicou M019–M020
nela e executou `followup.integration.mjs` com rollback. Após o teste, aplicou as
duas migrations no banco operacional e instalou a API. O backup é
`/var/backups/import-erp/erp_po_totvs_test_20261005T011817Z.dump`, SHA-256
`924524d95b96aa29b7d13dffc58d34cc649193b9e93dd5575ba59c70a64c0aad`.
A API anterior foi preservada em
`/var/backups/import-erp/m020-api-20261005T011823Z`. O ledger ficou 20/20.
O health público da API respondeu 200 e a rota nova, sem sessão, respondeu 401.
O commit `46aab37` foi enviado ao GitHub; a Vercel marcou
`dpl_7gxj7t5MwutEM2CD9apbFkbksquL` como `READY` no alias
`https://fup-comex-eletra.vercel.app`, cuja página de login respondeu 200.
O campo a campo e as regras estão em
[`docs/ACOMPANHAMENTO_CALCULOS_PO.md`](../../docs/ACOMPANHAMENTO_CALCULOS_PO.md).
A migração do histórico atualizado e o aceite com analistas continuam pendentes.

## Validação e release M022–M024

O release M022–M024 foi concluído em 2026-10-06 (evidências no início deste
arquivo). Para repetir apenas a validação em cópia restaurada, monte na VPS um
staging com o código da revisão e execute:

```bash
ERP_STAGE_DIR=/tmp/erp-m024-validation \
  python3 /tmp/erp-m024-validation/deploy/hostinger/validate-m024-on-copy.py
```

O validador exige M001–M021 no banco escolhido, cria e confere um backup,
restaura uma cópia descartável, aplica M022–M024 e executa os testes PostgreSQL de
operações e acompanhamento. Eles cobrem PO dividida entre IPs, IP compartilhado
por POs, quantidades e documentos conciliados por embarque, datas independentes,
limites de alocação, concorrência, edição, cancelamento, escopo e histórico.
Ao terminar, o validador remove somente a cópia de teste. Ele não altera o banco
operacional.

O release coordenado em `release-m024.sh` repete o validador, confere o ledger
M021 e as três migrations pendentes, cria novo backup, aplica M022–M024 e troca
o código da API. Se a nova API falhar no health check, restaura o código anterior;
as migrations aditivas ficam aplicadas para que o release possa ser retomado.
O release já foi executado e verificado em produção em 2026-10-06.

Para uma futura repetição autorizada, monte o staging da **mesma revisão** e rode:

```bash
ERP_STAGE_DIR=/tmp/erp-m024-validation \
  bash /tmp/erp-m024-validation/deploy/hostinger/release-m024.sh
```


## Release M018: preenchimento operacional de PO/IP (2026-10-04)

`release-m018.sh` validou M018 e `operations.integration.mjs` numa cópia restaurada
do banco operacional, preservou um backup verificável, aplicou a migration e
instalou a API. Backup:
`/var/backups/import-erp/erp_po_totvs_test_20261005T003022Z.dump`, SHA-256
`0d4ffe5038b3b1c72f35184630aaf9e3fb07d9859260e3bab9455fa201762bff`.
API anterior: `/var/backups/import-erp/m018-api-20261005T003032Z`. O ledger ficou
em 18/18 e o HTTPS público da API respondeu 200. A Vercel marcou o commit
`3fc1ee8` como `READY` no alias `https://fup-comex-eletra.vercel.app`.
Ainda falta o aceite com analistas. A carga da planilha atualizada não faz parte
deste release.

## Estado após o release M016/M017 (2026-10-03)

M016 e M017 passaram pela validação em cópia restaurada e isolada após backup
verificado; depois foram aplicadas ao banco operacional. O ledger ficou em
17/17. A role de runtime da API foi conferida com leitura da view de histórico
e sem SELECT direto na tabela de auditoria. A versão anterior da API foi
preservada em `/var/backups/import-erp/m017-api-20261003T173254Z`; o backup usado
foi `/var/backups/import-erp/erp_po_totvs_test_20261003T173247Z.dump`. A evidência
completa está no checklist vigente. A próxima validação operacional é o aceite
autenticado da interface e do escopo com perfil restrito real.

## Release M014: monitor da outbox

Prepare um staging sob `/tmp` com as migrations M001–M014, `dist/migrate.js`,
`dist/server.js`, `dist/admin-outbox.js`, os fontes correspondentes e
`validate-m014-on-copy.py`, `release-m014.sh`, `verify-api-ready.sh`.
Use o `node_modules` instalado na VPS e execute:

```bash
ERP_STAGE_DIR=/tmp/erp-m014-release bash /tmp/erp-m014-release/deploy/hostinger/release-m014.sh
```

O script exige M001–M013 aplicadas e M014 pendente. Ele faz backup verificável,
restaura uma cópia, aplica M014 nela, testa o grant e a leitura da view com a role
da API, depois migra o banco operacional e instala os arquivos da rota. Se a
checagem de saúde falhar, o `server.js` anterior é restaurado; M014 permanece.
Uma retomada exige `ERP_M014_RESUME=true` e o caminho/hash do backup verificado.

Em 2026-10-02, M014 passou em cópia restaurada e foi aplicada ao banco
operacional. Backup verificado:
`/var/backups/import-erp/erp_po_totvs_test_20261003T005132Z.dump`, SHA-256
`0f515d5fbc685b2ce15c214816a006fb3eede2488aa738430d62f437363dbc8b`.
API ativa e rota anônima da outbox retornando 401. Código anterior em
`/var/backups/import-erp/m014-api-20261003T005136Z`.
`verify-m014-operational.sh` confere ledger, grant e consulta da view com a role
da API.

## Release M013: histórico de solicitações

O código e a migration M013 devem ser enviados juntos à VPS. Monte um diretório
de staging sob `/tmp` com `apps/api/migrations/M001`–`M013`,
`apps/api/dist/migrate.js`, `apps/api/dist/requests.js`,
`apps/api/src/requests.ts` e os scripts `validate-m013-on-copy.py`,
`release-m013.sh` e `verify-api-ready.sh` em `deploy/hostinger`. O staging usa
`node_modules` já instalado na API da VPS. Depois de conferir o conteúdo:

```bash
ERP_STAGE_DIR=/tmp/erp-m013-release bash /tmp/erp-m013-release/deploy/hostinger/release-m013.sh
```

O script exige M001–M012 aplicadas e M013 pendente. Ele gera backup com hash,
restaura cópia isolada, aplica M013 na cópia, verifica o grant de leitura da view
para `import_erp_app`, aplica M013 no operacional e instala a rota da API. O código
anterior é guardado em `/var/backups/import-erp/m013-api-*`; em falha de saúde,
o script restaura somente o código. A migration aditiva permanece aplicada.
Se M013 for aplicada mas a instalação da API falhar, a retomada exige
`ERP_M013_RESUME=true`, `ERP_M013_BACKUP` e `ERP_M013_BACKUP_SHA256`; o script
confere o backup antes de instalar o código. O verificador de saúde normaliza
finais de linha do arquivo de staging, necessários em checkouts Windows.

Em 2026-10-02, M013 passou na cópia restaurada e foi aplicada ao banco
operacional. Backup verificado:
`/var/backups/import-erp/erp_po_totvs_test_20261003T003743Z.dump`, SHA-256
`4668a29297b3e506dd3ca76c8e266ca5e79b5fe1ff2469d21f8d6ef8bf712515`.
A primeira checagem de saúde falhou somente pelo CRLF do script de staging e
restaurou o código da API; a retomada controlada instalou a nova rota. Código
anterior em `/var/backups/import-erp/m013-api-20261003T004012Z`.
`verify-m013-operational.sh` confirma ledger, grant e consulta com a role da API.

Esta instalação usa a VPS `matheusproserv` e o banco operacional `erp_po_totvs_test` escolhido pelo usuário. O computador corporativo não executa componentes de produção. O código da API fica em `/opt/import-erp/apps/api`; configurações e segredos ficam em `/etc/import-erp`.

## Serviços

- `import-erp-api.service`: API Node 24, usuário de sistema `import-erp`, porta `172.18.0.1:4000` da rede privada `docker_gwbridge`.
- `import_erp_edge`: serviço Swarm Traefik dedicado à ponte interna; sem porta publicada. O Traefik compartilhado termina TLS e encaminha `api.72-60-250-212.sslip.io` para ele.
- PostgreSQL existente no serviço `postgres_postgres`: banco `erp_po_totvs_test`, role de runtime `import_erp_app`; a role separada `erp_po_totvs_migrator` é usada somente para migrations.

O provedor Hostinger permite 22, 80 e 443 e bloqueia as outras portas públicas. A porta 5432 continua publicada pelo Swarm, então mantenha a regra de firewall externa que a bloqueia. Não altere as rotas ou portas do Traefik compartilhado para manter os outros serviços.

## Ambiente e credenciais

### Acesso SSH temporário para RF06 (2026-09-30)

A chave anterior de RF06 não estava neste checkout. Em 2026-10-03 foi gerado
um par substituto em `.local-keys/rf06_m017_recovery_ed25519` (privada) e
`.local-keys/rf06_m017_recovery_ed25519.pub` (pública), fingerprint
`SHA256:TGiM4/V33UAHRLOXjWU0qikrq7bHR/Qn4mRH+kmjcBU`. O par está ignorado pelo
Git. A chave pública foi cadastrada na VPS pelo console administrativo; a
validação M016/M017 e o release foram concluídos em seguida. Preserve a chave
privada somente no checkout autorizado; não a transfira nem a inclua em releases.

O host conhecido é `srv1054123.hstgr.cloud` (`72.60.250.212`), usuário `root`.
Use `HostKeyAlias=72.60.250.212` quando necessário para conferir a chave de host
já registrada pelo IP:

```powershell
ssh -o BatchMode=yes -o HostKeyAlias=72.60.250.212 `
  -i .local-keys/rf06_m017_recovery_ed25519 -o IdentitiesOnly=yes `
  root@srv1054123.hstgr.cloud hostname
```
`/etc/import-erp/api.env` contém `DATABASE_URL`, `DATABASE_POOL_MAX`, `GATEWAY_TOKEN`, `AUTH_SESSION_SECRET`, `APP_PUBLIC_ORIGIN`, `HOST` e `PORT`; ele pertence a `root:import-erp` com modo `0640`. A URL do PostgreSQL usa `127.0.0.1` **da VPS** e TLS verificado pelo certificado fixado em `/etc/import-erp/postgres-root.crt`. O serviço não lê a credencial de migrations.

`/etc/import-erp/migration-release.env` contém a URL da role de migrations, pertence a `root:root` e tem modo `0600`. Não envie o conteúdo desses arquivos a chats, logs ou ao Git. No painel Vercel Production, `VPS_API_URL=https://api.72-60-250-212.sslip.io` e `VPS_API_TOKEN` deve ter o mesmo valor do `GATEWAY_TOKEN`. O token deve ser do tipo Secret. Não configure `DATABASE_URL` na Vercel.

O acesso inicial usa contas locais. Somente as duas contas `Master` provisionadas na VPS podem criar, editar, desativar e redefinir a senha dos demais usuários. Cada usuário recebe um papel e, quando houver dados, escopos de importadoras TOTVS. Contas criadas antes da importação ficam sem escopo e não leem POs até que um master atribua uma importadora. Senhas iniciais são geradas aleatoriamente e exigem troca no primeiro login. OIDC pode ser configurado depois, sem ser necessário para o login atual.

As senhas iniciais de `francisco.matheus@eletraenergy.com.br` e `ricardo.rodrigues@eletraenergy.com` foram gravadas somente em `/root/.config/import-erp/initial-master-credentials.txt`, modo `0600`. Cada master deve consultá-las no console da VPS, entrar em `https://fup-comex-eletra.vercel.app/login` e trocar a própria senha. Depois que ambos confirmarem a troca, remova esse arquivo da VPS. Nunca envie as senhas ao Git ou ao chat.

## Backup e migrations

Antes de aplicar M008, foi criado `/var/backups/import-erp/erp_po_totvs_test_20260929T144804Z.dump` e a restauração foi verificada em banco temporário. SHA256: `0b5ddab3fc8aa588538ddbceaff9ebe9daffe52f89b627a20eb2fa024b98f99c`. M008 foi aplicada primeiro nessa cópia, depois no banco escolhido. O ledger real registra M001–M008, sem pendências. Não aplique migrations automaticamente na inicialização da API.

Antes de M009, foi criado e restaurado `/var/backups/import-erp/erp_po_totvs_test_20260929T201031Z.dump`, SHA256 `a6728676fd546afa40cbe195e3958da4626c67af17d710a3cc57b6a661974d7a`. O login, a troca de senha, a criação de usuário, o isolamento de papel e a revogação foram exercitados na cópia temporária; ela foi removida. M009 foi aplicada ao banco operacional e o ledger registra M001–M009, sem pendências.

Em 2026-10-01, M010 foi validada primeiro em cópia restaurada, com criação,
replay idempotente, conflito de versão, escopo e rollback da outbox. O backup
imediatamente anterior à aplicação operacional é
`/var/backups/import-erp/erp_po_totvs_test_20261001T113403Z.dump`, SHA-256
`4fcc31fdb6cb530f89f308bfbd7ac7a505d078891f0c46eb7a608ff3ed204e86`;
foi restaurado e conferiu as 9 migrations anteriores. O ledger operacional
registra M001–M010, sem pendências. A primeira tentativa de reiniciar a API
fez a checagem de saúde cedo demais e restaurou automaticamente o código
anterior. A retomada esperou o serviço subir e confirmou HTTPS ready 200.
Reversão somente da API: `/var/backups/import-erp/m010-api-af9e297-20261001T113550Z`.
Não remova M010 do banco para reverter código: a migration é compatível com a
API anterior e futuras escritas do catálogo precisam permanecer íntegras.

Em 2026-10-01, M011 foi restaurada e validada em cópia temporária antes da
aplicação operacional. Backup imediatamente anterior:
`/var/backups/import-erp/erp_po_totvs_test_20261001T121101Z.dump`, SHA-256
`394c5def6653be18a4c74f749974603167611673df8b35f762850fb66e7e84fb`.
Ledger operacional: M001–M011, sem pendências. API de solicitações instalada,
ready HTTPS 200 e endpoint anônimo 401. Reversão somente do código:
`/var/backups/import-erp/rf03-m011-api-20261001T121107Z`; mantenha M011 aplicada
ao reverter o código, pois a migration é aditiva e não introduziu dados de
demonstração. O procedimento reproduzível está em `validate-m011-on-copy.py` e
`release-m011.sh`.

Para um novo release, inspecione o estado, faça backup restaurável e use o runner explícito de `apps/api`; a API lê credenciais diferentes das migrations. Os scripts deste diretório registram a sequência executada para este release. `publish-api-traefik.sh` cria a rota HTTPS somente uma vez e recusa alterar um serviço `import_erp_edge` existente.

Em 2026-09-30, a alteração de leitura RF06 foi compilada e testada em
`/tmp/rf06-validation-20260930`. `install-rf06-api.sh` instalou apenas
`src/purchase-orders.ts` e `dist/purchase-orders.js`, com cópias de reversão em
`/var/backups/import-erp/rf06-api-20260930T175932Z`. O serviço voltou a
`active` e `/health/ready` respondeu 200 via HTTPS. Não houve migration nem
alteração de dados. A prova de leitura usa `verify-rf06-read.sh` e
`verify-rf06-read.sql`; o teste de rotas com transação PostgreSQL `READ ONLY`
está em `apps/api/test/purchase-orders.real-read.mjs`.
O commit `d6b4604` foi enviado a `comexeletra/ERP_comex`; a API da Vercel
confirmou `dpl_38myVEUs8Wv8cLMEbo7aDVe74FXH` como `READY` e associado a
`fup-comex-eletra.vercel.app`. A URL pública respondeu 200 e a carteira anônima
401. `verify-vercel-deploy.py` consulta esse estado sem mostrar o token.

## Carga histórica de 2026

`import-historical-workbook.py` importa exclusivamente a planilha aprovada com
SHA-256 `d2f025ce6dc53a15574126217cf2148fb875fbb41408f266d6a486aa5f0d7f44`.
O XLSX é transferido diretamente para a VPS e permanece fora do Git e da Vercel.
O script exige as versões de `openpyxl` e `psycopg[binary]` fixadas em
`requirements-historical-import.txt` em um ambiente Python da VPS.
Sem `--apply`, faz somente a reconciliação da planilha. Com `--apply`, usa a role
de migração e uma transação única; a mesma planilha e versão de mapeamento
podem ser reapresentadas sem duplicar dados. Antes da primeira aplicação, exige
as tabelas históricas vazias. Faça `backup-erp-db.sh` e teste a carga em uma
cópia restaurada antes de executar no banco em uso.

```sh
/root/.config/import-erp/historical-import/venv/bin/python \
  /root/.config/import-erp/historical-import/import-historical-workbook.py \
  --workbook /root/.config/import-erp/historical-import/workbook.xlsx

/root/.config/import-erp/historical-import/venv/bin/python \
  /root/.config/import-erp/historical-import/import-historical-workbook.py \
  --workbook /root/.config/import-erp/historical-import/workbook.xlsx --apply
```

O arquivo aprovado tem 6.940 linhas de Pré Embarque e 190 de Pós Embarque:
7.130 linhas de origem, 336 POs distintas, 6.796 observações com PO, 200 IPs
e 449 vínculos PO–IP. As 144 linhas sem PO ficam na origem e na fila de
qualidade para o Master. A carteira mostra uma linha por PO e pagina 50 POs por
vez; o detalhe da PO pagina suas observações históricas.

## Verificação rápida

```sh
systemctl is-active import-erp-api
docker service ps import_erp_edge
curl --fail --silent --show-error https://api.72-60-250-212.sslip.io/health/live
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api.72-60-250-212.sslip.io/health/ready
```

As respostas esperadas são `active`, uma task `Running`, `{"status":"ok"}` e 401 sem token. Para a verificação autenticada, use o token somente dentro da VPS e não o imprima. `journalctl -u import-erp-api` e `docker service logs import_erp_edge` ajudam a diagnosticar falhas sem ler arquivos de segredo.

## Homologação vazia para testes

O banco `erp_po_totvs_hml` foi criado aplicando M001–M034, sem copiar dados de
outros ambientes. As roles de runtime e migração são separadas; a role da API
HML não tem leitura do banco operacional. Duas contas Master locais foram
criadas para permitir o primeiro acesso; as senhas temporárias estão somente
em `/root/.config/import-erp/homologation-master-credentials.txt` (modo 0600).
O banco não contém dados de negócio nem catálogo. Para validar novamente os
três ledgers e a ausência de dados de negócio:

```sh
ERP_MIGRATIONS_DIR=/opt/import-erp/apps/api/migrations \
  /tmp/verify-homologation-db.sh
```

A API separada escutará em `172.18.0.1:4001`, exposta por
`https://api-hml.72-60-250-212.sslip.io`. Para ativá-la, defina
`PREVIEW_PUBLIC_ORIGIN` com o alias HTTPS estável do Vercel Preview e execute
`enable-homologation-api.sh` junto ao arquivo `import-erp-hml-api.service`.
Depois, cadastre no escopo Preview da Vercel `PREVIEW_PUBLIC_ORIGIN`,
`PREVIEW_API_URL=https://api-hml.72-60-250-212.sslip.io` e
`PREVIEW_API_TOKEN` usando o `GATEWAY_TOKEN` do arquivo HML. A origem da API e
`PREVIEW_PUBLIC_ORIGIN` devem coincidir exatamente.

## Ciclo de vida da PO — Ciclo 2 (2026-10-21)

M064 foi validada em uma cópia restaurada e aplicada somente ao banco HML `erp_po_totvs_hml`. O backup pré-migration, em formato custom do PostgreSQL, foi validado com `pg_restore --list`: `/var/backups/import-erp/erp_po_totvs_hml-m064-20261021T121429Z.dump`, 466.108.155 bytes, SHA-256 `bec2a90765248535e42b8138fe35cd578634db6a51b64cbcde95d4d74ad4e608`. A cópia descartável `erp_po_hml_m064_check_20261021_503650` recebeu M064; os caminhos permitidos e bloqueados foram exercitados em transação com rollback, e a cópia foi removida. O ledger HML passou de M001–M063 para M001–M064 (64/64).

A integração usou somente a PO de teste criada no Ciclo 1. Pelas rotas da API HML, o fluxo `DELETED → ACTIVE → CANCELLED → ACTIVE → DELETED` foi concluído com versões atuais. As quatro transições tiveram motivo, quatro registros em `audit.audit_log` e os quatro eventos correspondentes em `audit.outbox_message`. A PO terminou `DELETED`; as contagens permaneceram 1 `ACTIVE` e 1 `DELETED`, sem alocações ativas; a outra PO permaneceu `ACTIVE` na mesma versão. O health local e HTTPS autenticado respondeu 200; a rota nova sem sessão respondeu 401. M064 e o release não foram aplicados em produção.

A API HML executa `/opt/import-erp/apps/api/hml-release-cc458b0/dist/server.js` pelo drop-in `/etc/systemd/system/import-erp-hml-api.service.d/zzzzz-release-cc458b0.conf`. Antes da troca, o drop-in e release efetivos (`hml-release-5165ca7`) foram preservados em `/var/backups/import-erp/hml-cycle2-api-cc458b0-predeploy-20261021`. Para rollback somente do código, restaure `zzzz-release-5165ca7.conf` desse backup como drop-in efetivo, remova o drop-in `zzzzz-release-cc458b0.conf`, execute `systemctl daemon-reload` e reinicie `import-erp-hml-api`. M064 deve permanecer aplicada no HML.

## Criação de PO — Ciclos 1–4 (2026-10-21)

O commit `40ed41e18f3b3d47c3351fa2839fa3c95ddd009c` implementa os ciclos 1–4 do plano de criação de PO e foi publicado na branch `homologacao`. Os testes, lint, type-check e builds locais passaram. A validação do parser com `PO 030201.xlsx` encontrou 215 linhas, sem preço derivado zero; a diferença máxima entre total de linha e quantidade × preço foi `0,00050223`, abaixo da tolerância de `0,01`.

Antes da M065, foi feito o backup HML `/var/backups/import-erp/erp_po_totvs_hml_m065_20261021T155629Z.dump` (422.248.448 bytes, SHA-256 `e25d777c9fe66110f43a9bc77eb4068cd99c205848ff967c3fd164da2f3d90d3`), validado com `pg_restore --list`. A cópia descartável `erp_po_hml_m065_copy_20261021_1559` foi restaurada, recebeu M065 e passou `validate-m065-on-copy.sql`; os testes foram executados em transação revertida e a cópia foi removida. O checksum da migration aplicada é `22a33ea2009c6bdf1c136af2e002b5fa7b567e0642ec2671d4cd93beec038053`.

M065 foi aplicada somente em `erp_po_totvs_hml`. O ledger passou de M001–M064 para M001–M065 (65/65). Antes e depois da migration, havia 2 POs, 215 itens, 1 alocação, 8.095 linhas de auditoria e 6.585 mensagens outbox. As tabelas de observação de preço e descrição ficaram vazias, sem carga retroativa.

A API HML executa `/opt/import-erp/apps/api/hml-release-40ed41e/dist/server.js`; o drop-in de release é `/etc/systemd/system/import-erp-hml-api.service.d/zzzzzz-release-40ed41e.conf`. A cópia pré-deploy ficou em `/var/backups/import-erp/hml-po-creation-40ed41e-predeploy`. O serviço `import-erp-hml-api` está ativo, `/health/live` respondeu 200 e a nova rota protegida sem sessão respondeu 401. O runtime continuou conectado como `import_erp_hml_app` ao banco `erp_po_totvs_hml`. A validação autenticada de criação e correção de PO ficou pendente: uma conta Master não aceitou a senha guardada no arquivo protegido e a outra exige troca de senha; nenhuma senha foi alterada e nenhuma PO foi criada ou alterada.

O deployment Vercel `dpl_DTsSVLdansCT9TDen81TfJfDaHMq` estava `READY`, na branch `homologacao`, para o mesmo commit. Seu alias é `erp-comex-git-homologacao-eletra-comex.vercel.app`. A URL específica do deployment e o alias estável responderam com redirecionamento HTTP 302 para a proteção SSO da Vercel, portanto o conteúdo da aplicação não pôde ser validado pelo domínio. Nenhuma configuração da Vercel, produção ou banco de produção foi alterada.

A continuação web do plano (commit `49157a6c3c6ac846b287e47887a2bceaa2d00809`) concluiu F2–F5 e está no deployment `dpl_TYpAf7R3RcK345MFQXtF2aQBBRkY`, `READY`, branch `homologacao`, com status Vercel `success`. O alias estável continua protegido: tanto `erp-comex-6smhk9rsy-eletra-comex.vercel.app` quanto `erp-comex-git-homologacao-eletra-comex.vercel.app` redirecionam HTTP 302 para `/sso-api` em `vercel.com`. A continuação altera somente a web; a API HML permanece no release `40ed41e`. Os 70 testes web, type-check e build passaram; lint terminou sem erros e com 40 avisos preexistentes.
