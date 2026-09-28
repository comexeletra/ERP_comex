# Instalar API na VPS Hostinger

Este roteiro deixa a API independente do computador pessoal. A API escuta
somente `127.0.0.1:4000`; Nginx publica HTTPS e PostgreSQL permanece em
loopback. Os arquivos `.service` e `.conf.example` são modelos sem credenciais
nem certificados.

## Pré-requisitos

- VPS Linux suportada pela Hostinger, com atualizações de segurança aplicadas.
- Node.js 24.x, PostgreSQL ativo, Nginx e um hostname sob seu controle.
- DNS do hostname apontando para a VPS e certificado TLS válido.
- Backup do banco e procedimento de restauração verificado.

Não abra a porta PostgreSQL 5432 na firewall pública. Libere 443 para HTTPS;
22 deve ser limitado às origens administrativas conhecidas. Não é necessário
instalar Docker.

## Instalação inicial

Os comandos abaixo são um roteiro para executar na VPS como administrador;
substitua os diretórios somente pelos caminhos escolhidos na VPS.

```sh
useradd --system --home /var/lib/import-erp --create-home --shell /usr/sbin/nologin import-erp
install -d -o import-erp -g import-erp /opt/import-erp /var/lib/import-erp
install -d -o root -g import-erp -m 0750 /etc/import-erp
```

Copie o repositório para `/opt/import-erp`, instale dependências a partir do
`apps/api/pnpm-lock.yaml` e compile `apps/api` com Node.js 24 e Corepack:

```sh
cd /opt/import-erp/apps/api
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

## Validar migrations no banco de teste

Antes de instalar o serviço persistente, valide M001–M007 no banco isolado
`erp_po_totvs_test`. O teste usa a role exclusiva de migrations e a conexão
local PostgreSQL. Crie `/etc/import-erp/migration-test.env` com modo `0600`,
propriedade `root:root`, contendo `MIGRATION_ENV=isolated` e
`MIGRATION_DATABASE_URL` apontando para `127.0.0.1` e para esse banco. Não
coloque a URL de conexão em comandos, Git, logs ou no chat. Para um alvo local,
`ALLOW_REMOTE_MIGRATIONS` deve permanecer ausente.

De dentro de `/opt/import-erp/apps/api`, execute com o Node 24 instalado em
`/opt/node-v24`:

```sh
/opt/node-v24/bin/node --env-file=/etc/import-erp/migration-test.env dist/migrate.js status
/opt/node-v24/bin/node --env-file=/etc/import-erp/migration-test.env dist/migrate.js up
/opt/node-v24/bin/node --env-file=/etc/import-erp/migration-test.env dist/migrate.js status
/opt/node-v24/bin/node --env-file=/etc/import-erp/migration-test.env dist/migrate.js up
```

O primeiro status deve mostrar sete pendentes; o primeiro `up` aplica M001–M007;
o status seguinte deve mostrar sete aplicadas; o segundo `up` deve aplicar zero.
Confirme também `migration.schema_migration` com `psql` antes de registrar o
resultado no checklist. Se o banco não estiver vazio, pare e revise antes de
aplicar. Não marque DEV05 concluído apenas pelo build ou pelo status.

Para validar detecção de checksum, use apenas uma cópia temporária desta
instalação e o banco isolado: preserve uma cópia do arquivo SQL de uma migration
já aplicada, acrescente uma alteração inócua somente ao arquivo temporário,
execute `migrate:status` e confirme a falha explícita por checksum divergente.
Restaure o arquivo SQL byte a byte antes de seguir. Não altere migrations
aplicadas no repositório nem no release compartilhado. Mantenha o arquivo de
ambiente temporário com modo `0600` e apague-o ao terminar.

### Evidência da validação isolada na VPS — 2026-09-28

No pacote temporário `/tmp/api-migration-validation`, o runner rejeitou a
alteração de checksum em uma cópia de `M007_auth_sessions.sql`. O backup foi
restaurado imediatamente; um status posterior confirmou sete migrations
aplicadas e zero pendentes.

Para exercitar upgrade e concorrência, foi criada somente no pacote temporário
uma M008 de prova que cria
`public.migration_validation_upgrade_probe_20260928`. Duas execuções simultâneas
de `migrate:up` terminaram sem erro: uma aplicou M008 e a outra aplicou zero.
O status mostrou oito aplicadas e zero pendentes. A tabela e a linha
`M008_validation_upgrade_probe_20260928.sql` do ledger foram removidas do banco
`erp_po_totvs_test` em transação; o arquivo M008 e os logs temporários também
foram removidos. O status final confirmou M001–M007 aplicadas e zero pendentes.

A senha da role de teste foi redefinida interativamente com `psql` (`\password`);
nenhum segredo foi registrado. O arquivo de ambiente temporário foi criado com
modo `0600` e removido após a validação. O banco operacional não foi acessado.
Na VPS, a porta local 5432 é publicada pelo serviço Docker Swarm
`postgres_postgres`; para manutenção da role, a sessão `psql` foi aberta dentro
do container, pois não há usuário de sistema `postgres` no host.
O teste usou `uselibpqcompat=true&sslmode=require` por causa do certificado
self-signed sem SAN; isso não valida a identidade do servidor nem o TLS de
produção. DEV05 permanece parcial até CI e TLS de produção serem validados.

Crie `/etc/import-erp/api.env` no próprio servidor, modo `0640`, pertencente a
`root:import-erp`. Preencha `DATABASE_URL` com a role exclusiva da aplicação e
um endpoint local; adicione `GATEWAY_TOKEN`, issuer/client OIDC, segredo de
sessão e origem pública da aplicação. Gere os segredos no servidor e não os
coloque no Git, no histórico do shell ou neste arquivo.

## Serviço persistente

Instale `import-erp-api.service` em `/etc/systemd/system/` e ajuste
`WorkingDirectory` e `ExecStart` se o diretório de instalação mudar. Então:

```sh
systemctl daemon-reload
systemctl enable --now import-erp-api
systemctl status import-erp-api
journalctl -u import-erp-api --since today
```

`enable` configura início após reinicialização; `Restart=always` reinicia o
processo se ele falhar. `systemctl status` e os logs não devem exibir segredos.

## HTTPS e proxy reverso

Configure DNS e TLS para o hostname da API. Copie
`nginx-api.conf.example` para a configuração do virtual host, substitua
`api.example.com`, aponte `ssl_certificate` e `ssl_certificate_key` para os
arquivos protegidos do certificado e valide/recarregue o Nginx:

```sh
nginx -t
systemctl reload nginx
```

Na Vercel Production, configure `VPS_API_URL` como a origem HTTPS real, sem
caminho ou credenciais, e `VPS_API_TOKEN` como Secret com o mesmo valor de
`GATEWAY_TOKEN` deste serviço. Não cadastre `DATABASE_URL` nem credenciais OIDC
na Vercel. Mantenha Preview sem essas variáveis até instalar uma API de staging
separada, ligada apenas a um banco isolado e a um cliente OIDC de teste. Não
aponte Preview para a API/banco de produção. O app responde 503 para rotas da
API quando as duas variáveis Vercel não estão presentes.

## Atualizações e disponibilidade

Faça backup, atualize o checkout em diretório de release, rode a instalação
congelada e `pnpm build`, então troque o release e reinicie com
`systemctl restart import-erp-api`. Confirme `/health/live` pelo endpoint
HTTPS e `/health/ready` por uma chamada com gateway autorizado, sem registrar o
token. Em falha, volte ao release anterior e preserve o banco.

O serviço não depende do PC. A VPS, o PostgreSQL, Nginx/TLS, DNS e a conta
Vercel continuam sendo dependências de produção; configure monitoramento,
backup e renovação automática do certificado.

## Limite atual

A API Fastify inclui health checks, token de gateway, OIDC/PKCE, sessão
PostgreSQL, CSRF, logout e runner explícito de migrations. O primeiro
administrador pode ser provisionado pelo comando manual documentado em
`apps/api/migrations/README.md`. M001–M007, divergência de checksum e upgrade
concorrente foram validados no banco PostgreSQL isolado; o banco terminou com
M001–M007 aplicadas. A validação TLS de produção e a execução da CI ainda pendem. Login OIDC
não foi validado contra issuer. A API carrega grants DEV04 pela identidade
`(issuer, subject)` em cada chamada `/api/v1`, exige permissão e declaração de
modo de escopo em cada rota (por importador; global apenas para `users.manage`),
e fornece predicado SQL para aplicar o escopo antes da paginação e também em consultas por ID. `GET /api/v1/purchase-orders`, `GET /api/v1/purchase-orders/{id}/overview` e `GET /api/v1/purchase-orders/{id}/history-items` usam guards e escopo SQL, inclusive nos IPs vinculados; 404 oculta POs fora do escopo. O overview retorna somente dados existentes em M001–M007 e marca itens/saldo oficiais como desconhecidos. A tela mostra histórico com linhagem e custos no grão do IP. Escrita operacional segue parcial; a fila de qualidade tem endpoints Node, mas M008 e validacao integrada ainda pendem; campos ausentes no schema não são apresentados como zero.
401 representa sessão ausente, 403 permissão
insuficiente e uma consulta restrita sem correspondência responde 404. Não
coloque a API em produção operacional até a checklist registrar paridade e
validações de segurança concluídas.
