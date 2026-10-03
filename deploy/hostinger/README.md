# API ERP na VPS Hostinger

> As seções de migrations abaixo são registros de releases anteriores.
> [O checklist vigente](../../CHECKLIST_ATUAL_IMPLEMENTACAO.md) registra M001–M014
> no histórico operacional. Confira o ledger real antes do próximo release.

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

Na sessão de 2026-09-30, o par temporário estava em
`.local-keys/rf06_ed25519` (privada) e `.local-keys/rf06_ed25519.pub` (pública).
A pasta inteira está no `.gitignore` e **não** entra no pacote de release nem
no Git. Fingerprint da pública: `SHA256:S5y5JFC6znJh9aId1V6GLzIjYsnQ9x963Pti7wL7ivs`.
No checkout verificado em 2026-10-03, esse arquivo não estava disponível e não
havia identidade carregada no `ssh-agent`; a validação/remessa à VPS depende de
restaurar um meio de acesso autorizado.
O host conhecido é `srv1054123.hstgr.cloud` (`72.60.250.212`), usuário `root`.
Use o OpenSSH com `-i .local-keys/rf06_ed25519 -o IdentitiesOnly=yes` a partir
da raiz do checkout. Em 2026-09-30, a conexão autenticada confirmou o host
`matheusproserv`. O usuário pediu para conservar o par local para sessões
futuras; ele deve permanecer ignorado pelo Git e não ser copiado para artefatos
de release. A revogação na VPS fica para quando esse acesso deixar de ser
necessário.

Para restaurar o acesso, recupere a chave privada do cofre/local autorizado para
`.local-keys/rf06_ed25519` (não a envie pelo chat nem a adicione ao Git) ou carregue
essa identidade no `ssh-agent`. Confirme o fingerprint público esperado acima e
use `ssh -o BatchMode=yes -i .local-keys/rf06_ed25519 -o IdentitiesOnly=yes`
para o teste de conexão. Não gere uma chave substituta sem provisionar e aprovar
a chave pública correspondente no servidor.

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
