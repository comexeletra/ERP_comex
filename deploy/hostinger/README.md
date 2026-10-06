# API ERP na VPS Hostinger

> O [checklist vigente](../../CHECKLIST_ATUAL_IMPLEMENTACAO.md) registra M001–M024 aplicadas no banco operacional. As instruções de release M013/M014 abaixo são históricas. Confira o ledger real antes de qualquer release futuro.

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
