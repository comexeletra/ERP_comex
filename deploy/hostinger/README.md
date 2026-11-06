# API ERP na VPS Hostinger

## Painel de Pós Embarque no HML (2026-11-06)

Os commits `a30d9a0` (API) e `db927e8` (web) trazem para `/reports/post` as métricas do painel Power BI de Pós Embarque, uma linha por IP, com os dados de pós-embarque do IP (`docs/PLANO_DASHBOARD_POS_EMBARQUE.md`): `GET /api/v1/reports/post-shipment/summary`, `/lines` e `/filter-options` (permissão `processes.read`, escopo por importadora). As rotas passam pela fila de `work-gate.ts` compartilhada com o End to End e o Pré Embarque. `shipmentDates` de `followup-calculations.ts` passou a ser exportado (mesma regra de ETA/ETE). Não há migration.

O release `/opt/import-erp/apps/api/hml-release-2fcfde4` foi montado com `git -c core.autocrlf=false archive 2fcfde4:apps/api` (SHA-256 `65f65770…8dec`, nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-c6af0ce` (lockfile igual; `package.json` diferente só no script de teste), compilado na VPS e ativado pelo drop-in de 67 `z` `…-release-2fcfde4.conf`; o worker foi movido com `enable-homologation-export-worker.sh 2fcfde4`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-post-dashboard-2fcfde4-predeploy`. Rollback somente do código: remova o drop-in `2fcfde4`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-c6af0ce`) e rode `enable-homologation-export-worker.sh c6af0ce`.

No release passaram `post-shipment-dashboard` (17), `pre-shipment-dashboard` (12), `followup-calculations` (26) e `work-gate` (5), com `--test-skip-pattern="built by the web|web lists"` (os contratos com a web rodaram no repositório). O ensaio só leitura (`post-rehearsal.mjs`, `default_transaction_read_only=on`, `--max-old-space-size=256`) comparou o resumo da rota com SQL independente: 224 IPs, 227 contêineres, 36 on water (DSA 16%), LT Doc médio 17,86, SLA TXT médio 39,21, status 2/10/20/7/185, 30 prioritários, canal verde 186 e vazio 32, e o lead time em tempo real de jan a nov/2026 (27,22 … 20) iguais; médias dos meses 14,50 (tempo real) e 13,95 (entregues), contra 14,49 e 14 no BI. Resumo em 47 ms, tabela em 41 ms, rajada de 16 chamadas pela fila sem falha em 449 ms, heap máximo de 17 MB. `/health/live` respondeu 200, a rota sem sessão respondeu 401, e API e worker ficaram ativos no `2fcfde4` (RSS 138 MB). Preview `homologacao` Ready (`erp-comex-7iavvlwkp`), `/reports/post` respondeu 200. Scripts e log em `/root/claude-release-2fcfde4` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Valores das etapas na cor do cabeçalho na exportação do End to End no HML (2026-11-06)

O commit `c6af0ce` (API) preenche as células de valor das colunas T0–T5 da exportação do End to End com a mesma cor do cabeçalho da etapa, no lugar do tom claro (pedido do usuário: cores mais fortes no arquivo). `exportStageColors` passou a ter só `header` e `border`; a tela não mudou (`docs/PLANO_EXPORTACAO_COLUNAS.md`, seção 10). Não há migration.

O release `/opt/import-erp/apps/api/hml-release-c6af0ce` foi montado com `git -c core.autocrlf=false archive c6af0ce:apps/api` (SHA-256 `035692a9…6794`, nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-36fe8c1` (`package.json` e lockfile iguais), compilado na VPS e ativado pelo drop-in de 66 `z` `…-release-c6af0ce.conf`; o worker foi movido com `enable-homologation-export-worker.sh c6af0ce`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-stage-values-c6af0ce-predeploy`. Rollback somente do código: remova o drop-in `c6af0ce`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-36fe8c1`) e rode `enable-homologation-export-worker.sh 36fe8c1`.

No release passaram `test/purchase-order-export.test.mjs` (5) e `test/export-jobs.test.mjs` (8, com `--test-skip-pattern="built by the web"`: o contrato com a web importa `../../web/lib` e rodou no repositório, como `test/export-columns.test.mjs`). A primeira tentativa parou nesse teste antes de ativar e não mudou nada (`release-attempt1.log`). O ensaio só leitura no HML gerou e releu o arquivo com o código do release: todas as linhas, 2.300 linhas e 47 colunas (397 KB), 69.000 células de valor das 30 colunas de etapa na cor do cabeçalho; T3 acumulada, 1.158 linhas e 48 colunas (214 KB), 34.740 células. As demais colunas ficaram sem preenchimento. RSS do ensaio 369 MB. `/health/live` respondeu 200, a rota de exportação sem sessão respondeu 401, e API e worker ficaram ativos no `c6af0ce`. Scripts e logs em `/root/claude-release-c6af0ce` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Busca de NCM oficial sem carregar o catálogo no HML (2026-11-05)

A busca "Pesquisar NCMs oficiais" ficava em "Pesquisando…" e derrubava a API HML (`JavaScript heap out of memory`; 6 quedas desde 03/11, 3 logo após buscas). A rota `GET /api/v1/ncms/official-search` lia todo o `catalog.ncm_official_item` para a memória antes de filtrar: 10.516 NCMs com 1,36 GB de atributos em texto (até 440 kB por NCM), acima do heap de 2.240 MB do Node na VPS. `POST /api/v1/ncms/import-official` fazia o mesmo.

O commit `36fe8c1` (API) cria `createPersistedOfficialNcmLookup` em `src/ncm-snapshot.ts`: a busca filtra (descrição contém o termo, sem diferenciar maiúsculas; código contém os dígitos), aplica a vigência na data de Brasília, ordena, conta e pagina no PostgreSQL, e só a página pedida traz os atributos; o cadastro lê só o código escolhido. A cópia arquivada (`ncm_last_siscomex_item`) continua valendo quando o snapshot atual é MDIC. O provider em memória só é usado com o banco sem snapshot. A resposta e a web não mudaram. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-36fe8c1` foi montado com `git -c core.autocrlf=false archive 36fe8c1:apps/api` (SHA-256 `c4e1b9f4…5310`, nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-31b685b` (`package.json` e lockfile iguais), compilado na VPS e ativado pelo drop-in de 65 `z` `…-release-36fe8c1.conf`; o worker foi movido com `enable-homologation-export-worker.sh 36fe8c1`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-ncm-search-36fe8c1-predeploy`. Rollback somente do código: remova o drop-in `36fe8c1`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-31b685b`) e rode `enable-homologation-export-worker.sh 31b685b`.

No release, `ncm-snapshot` (11), `catalog.ncms.official` (9), `ncm-sync` e `siscomex-ncm` (14) passaram; `/health/live` respondeu 200 e a busca sem sessão, 401. O ensaio só leitura (`ncm-search-rehearsal.mjs`, `--max-old-space-size=256`) comparou 11 buscas do código novo com o algoritmo anterior aplicado a uma cópia leve (código, nome e vigência): mesmas contagens e mesma ordem em todas (ex.: "cabo" 23 em 33 ms, "moto" 72, "óleo" 68, "8544" 13, "50%" 796), heap máximo de 34 MB; a collation `en_US.utf8` faz `lower()` tratar acentos como o JS. Por erro na preparação, o ensaio enviado no release estava vazio e a ativação ocorreu sem ele; ele foi refeito logo depois contra o release ativo, com o resultado acima. Scripts e logs em `/root/claude-release-36fe8c1` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

Continua pendente: a sincronização automática das 06:00/12:00 baixa e interpreta o catálogo inteiro do Siscomex dentro da API e o mantém em cache (6 h no provider do Siscomex e até a próxima rodada no provider persistido); as quedas de 03/11 06:01 e 04/11 12:02 coincidem com esses horários.

## Fila dos cálculos do End to End no HML (2026-11-04)

Cliques seguidos nos gráficos do End to End respondiam HTTP 500. O log da API mostrava `timeout exceeded when trying to connect` (35 vezes em 6 horas, desde o release `65846f8`). Cada clique pede a tabela e o resumo, e as duas rotas recalculam todas as linhas dos filtros: de 0,5 a 2,2 s cada no HML, medido com o código do release. O navegador cancela o pedido anterior, mas a API continuava a calculá-lo. Com o pool de 5 conexões, um pedido que espera mais de 5 s falha, e a rajada derrubava todos os pedidos, inclusive a verificação de sessão. Um ensaio só leitura de 8 cliques com o código do `6c2ddb4` reproduziu o erro em 16 de 32 chamadas.

O commit `c689986` (API) faz `GET /api/v1/purchase-order-lines` e `/e2e-stages` passarem por uma fila própria (`src/work-gate.ts`), com no máximo 2 cálculos ao mesmo tempo (`E2E_CALCULATION_CONCURRENCY`). As outras 3 conexões ficam livres para a sessão e as demais telas. Um pedido na fila cujo cliente já fechou a conexão é descartado sem calcular e responde 503 `REQUEST_CANCELLED`. O commit `4f50c38` (web) só pede a tabela e o resumo depois de 250 ms sem nova mudança e repete 500, 502, 503, 504 e falhas de rede após 1 s e 3 s, sem guardar a falha como dado carregado. O pool (`DATABASE_POOL_MAX`) não foi alterado. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-c689986` foi montado com `git -c core.autocrlf=false archive c689986:apps/api` (SHA-256 `48cce08b…9e15`, nenhuma fonte com CR). Ele reaproveita o `node_modules` de `hml-release-6c2ddb4`: lockfile igual e `package.json` diferente só no script de teste. Foi compilado na VPS e ativado pelo drop-in de 60 `z` `…-release-c689986.conf`; o worker foi movido com `enable-homologation-export-worker.sh c689986` do próprio commit. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-e2e-gate-c689986-predeploy`. Rollback somente do código: remova o drop-in `c689986`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-6c2ddb4`) e rode `enable-homologation-export-worker.sh 6c2ddb4`. A web pode ficar, porque só muda quando e quantas vezes pede.

No release, `test/shipment-lines.test.mjs` (20 testes; os 2 de contrato com a web rodaram no repositório) e `test/work-gate.test.mjs` (5) passaram. O ensaio só leitura de 8 cliques contra o HML, com o código novo, teve 32 de 32 chamadas sem erro, e a sessão mais lenta levou 23 ms. Cancelando os pedidos superados, como a tela faz, foram 0 falhas, 12 descartados e 4 s no total. `/health/live` respondeu 200, a rota sem sessão respondeu 401 e o worker ficou ativo no `c689986`. Scripts e log em `/root/claude-release-c689986` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Ctrl+clique nos gráficos de prazo e de faixa de atraso no HML (2026-11-04)

O commit `6c2ddb4` estende a seleção do gráfico de status aos gráficos "Quantidade por situação do prazo" e "Quantidade por faixa de atraso": o clique escolhe uma categoria, Ctrl+clique (Cmd+clique) soma ou remove, e "Limpar seleção" limpa todas. A API passou a aceitar um ou mais valores em `deadline` e `delayRange` nas linhas, no resumo e na exportação, e uma chave vazia (`deadline=`) deixou de ser recusada e não filtra. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-6c2ddb4` seguiu o procedimento do `afb5fef` (`node_modules` de `hml-release-afb5fef`) e foi ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-6c2ddb4.conf`; o worker foi movido com `enable-homologation-export-worker.sh 6c2ddb4`. Drop-ins anteriores: `/var/backups/import-erp/hml-chart-lists-6c2ddb4-predeploy`. Rollback somente do código: remova o drop-in `6c2ddb4`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-afb5fef`) e rode `enable-homologation-export-worker.sh afb5fef`, com a web junto. `test/shipment-lines.test.mjs` passou no release (18 testes) e `/health/live` respondeu 200. Conferência só leitura contra o HML, na situação "Em aberto" (2.300 linhas): `late`+`noData` trouxe 1.630, igual à soma e ao total do resumo; `upTo30`+`days30To45` trouxe 441, igual à soma; o gráfico de prazo mostrou as mesmas quantidades com e sem a própria seleção. O Preview `dpl_DtsHt9gYWxGePRFkSeVuzrJ7M9qm` (commit `6c2ddb4`) ficou `Ready` no domínio estável. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Seleção múltipla nos filtros do End to End no HML (2026-11-04)

O commit `afb5fef` troca os filtros de lista do End to End (PO, Importadora, Produto, IP, Status, Grupo e Finalidade) por caixas de marcar com busca e "Selecionar tudo", como no Power BI (especificação em `docs/PLANO_FILTROS_MULTIPLOS.md`). A API passou a aceitar um ou mais valores exatos em `status`, `group` e `purpose` (chave repetida na URL, array no corpo da exportação) e as listas novas `importers`, `purchaseOrders`, `ipNumbers` e `productCodes`, até 500 valores cada; `importer`, `purchaseOrder`, `ipNumber` e `product` continuam buscando por trecho para a Carteira por produto. As exportações passam a gravar `status`, `group` e `purpose` como listas; jobs antigos com texto continuam válidos. Não há migration. A web foi publicada alguns minutos antes da API; nesse intervalo, filtros com mais de um valor no Preview recebiam 400.

O release `/opt/import-erp/apps/api/hml-release-afb5fef` seguiu o mesmo procedimento do `1e0fd1a` (archive sem CR, `node_modules` de `hml-release-1e0fd1a` com `package.json` e lockfile iguais, compilação na VPS) e foi ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-afb5fef.conf`; o worker foi movido com `enable-homologation-export-worker.sh afb5fef`. Drop-ins anteriores: `/var/backups/import-erp/hml-multi-select-afb5fef-predeploy`. Rollback somente do código: remova o drop-in `afb5fef`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-1e0fd1a`) e rode `enable-homologation-export-worker.sh 1e0fd1a`; a web precisa voltar junto, porque envia as listas. `test/shipment-lines.test.mjs` passou no release (17 testes) e `/health/live` respondeu 200. Conferência só leitura com o código do release contra o HML: das 6.882 linhas, a lista `ENTREGUE`+`DESEMBARAÇO` trouxe 4.909, igual à soma dos dois status e ao total do resumo; `Energy`+`Livoltek` (6.070), `Amostra`+`Despesa` (98) e duas POs (3) também deram a soma dos valores isolados; todas as importadoras juntas deram as 6.882; a PO em minúsculas trouxe o mesmo resultado. O Preview `dpl_3LtZQb8V2pSoXXEGBmmdKkgf3NHB` (commit `afb5fef`) ficou `Ready` no domínio estável. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Status ENTREGUE e CANCELADO com a situação "Em aberto" no HML (2026-11-04)

O commit `1e0fd1a` corrige o filtro de status do End to End e da Carteira por produto: com a situação padrão "Em aberto" (`situation=open`), a consulta excluía `ENTREGUE` e `CANCELADO`, e escolher um desses status não listava nada. A API passou a tratar esses dois status como "Todas" (`lineSituation` em `shipment-lines.ts`) na tabela, no resumo e na exportação, e a tela muda a Situação para "Todas" ao escolher um deles. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-1e0fd1a` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-65846f8` (`package.json` e lockfile iguais, conferidos com `cmp`), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-1e0fd1a.conf`; o worker foi movido com `enable-homologation-export-worker.sh 1e0fd1a`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-status-situation-1e0fd1a-predeploy`. Rollback somente do código: remova o drop-in `1e0fd1a`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-65846f8`) e rode `enable-homologation-export-worker.sh 65846f8`. `test/shipment-lines.test.mjs` passou no release (15 testes; os dois de contrato com a web importam `apps/web`, que não vai no release, e rodaram no repositório); `/health/live` respondeu 200. Conferência só leitura com o código dos dois releases contra o HML (`default_transaction_read_only=on`): 185 IPs com `delivery_date`; `status=ENTREGUE` com "Em aberto" listava 0 linhas e passou a 4.582 (igual a "Todas"), e o resumo, de 0 para 4.582; `CANCELADO` tem 0 linhas nas duas situações; `DESEMBARAÇO` continua com 327. O Preview `dpl_43fwdv4xbwPsSZ9Gys1MZbQea5as` (commit `1e0fd1a`) ficou `Ready` no domínio estável. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Formulário de filtros do End to End no HML (2026-11-04)

Os commits `cd887ef` (API) e `65846f8` (web) juntam os filtros da tabela End to End num formulário dentro do Resumo da carteira. A API passou a filtrar as linhas, o resumo e a exportação por `group` e `purpose` (valor exato, sem diferenciar maiúsculas) e por `necessityFrom`/`necessityTo` (data de necessidade do produto), e ganhou `GET /api/v1/purchase-order-lines/filter-options` com grupos, finalidades, importadoras, POs, IPs e produtos das importadoras do usuário. Não há migration. A web foi publicada antes da API; até o release, a tela ficou sem as listas de opções.

O release `/opt/import-erp/apps/api/hml-release-65846f8` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-e830415` (`package.json` e lockfile iguais, conferidos com `cmp`), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-65846f8.conf`; o worker foi movido com `enable-homologation-export-worker.sh 65846f8`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-e2e-filter-form-65846f8-predeploy`. Rollback somente do código: remova o drop-in `65846f8`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-e830415`) e rode `enable-homologation-export-worker.sh e830415`; a web nova precisa voltar junto, porque chama a rota de opções. A API HML escuta em `HOST`/`PORT` de `/etc/import-erp/homologation-db.env` (rede do Docker, não `127.0.0.1`): `/health/live` respondeu 200 nesse endereço. Sem sessão, toda rota `/api/v1` responde 401, inclusive as inexistentes; por isso a rota nova foi conferida executando o código do release contra o HML, só leitura: 5 grupos, 9 finalidades, 3 importadoras, 329 POs, 222 IPs e 1.866 produtos; das 6.882 linhas, 5.340 do grupo Energy, 97 da finalidade Despesa e 495 com necessidade em 2026-11. O Preview `dpl_73Bd6gvx5sC5KkgBYoXcmxN4gCeG` (commit `65846f8`) ficou `Ready` no domínio estável. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Fornecedor por ensaio, NCMs oficiais e pendências da carga no HML (2026-11-04)

Com autorização do usuário ("resolva o que dá pra resolver"), três correções no `erp_po_totvs_hml`, feitas pelo `dist` de `hml-release-e830415` com o ator Master Francisco Matheus. As outras regras não têm evidência no banco para correção por ensaio: a PO ou a data correta está fora do sistema (Protheus, BL, rastreio) ou a decisão é de negócio.

- **PO sem fornecedor:** 030668 e 031287 receberam HEXING por `POST /api/v1/quality/current/fixes` (`PO_SUPPLIER`, chave `fornecedor-estatistica-20261104-HEXING`), por `apply-supplier-plan.mjs`. Evidência: o carregador M24010E2EYGIR11003 da 030668 foi comprado da HEXING em 3 POs, pelo mesmo preço. Dos 14 produtos da 031287 (marca LIVOLTEK, ELETRA CURITIBA), 10 foram comprados da HEXING em outras POs, as outras 11 POs da ELETRA CURITIBA são da HEXING e o fornecedor LIVOLTEK nunca vendeu esses códigos. O gatilho da M041 ligou o fornecedor do cadastro. Ficou a 031335 (robô industrial), sem histórico.
- **NCM não cadastrada:** 90303321 e 84193900, vigentes na cópia persistida do catálogo Siscomex (sincronizada às 06:01, sem consulta ao Siscomex), foram cadastradas por `POST /api/v1/ncms/import-official` (`register-ncms.mjs`, chave `ncm-cadastro-20261104-<código>`). Ficou 1 item com 38249999, que não existe na tabela vigente e precisa de NCM substituta revisada.
- **Pendências da carga (`migration.data_issue`):** 83 foram encerradas por `POST /api/v1/data-issues/:id/resolve` (`resolve-legacy.mjs`, chave `carga-resolvida-20261104-<id>`), e cada uma traz como evidência o estado atual do registro. São 77 `PRICE_WITHOUT_CURRENCY`, cujo item agora tem moeda; 2 `PO_WITHOUT_SUPPLIER`; e 4 `SC_MULTIPLE_SUPPLIERS`, cuja SC ficou sem fornecedor e sem PO ligada, com o número em cada produto, como decidido na carga. Ficaram abertas a PO 031335 e o item cancelado HXWSG100R22014-CEMIG, ainda sem moeda.

Cada etapa só gravou depois que a prévia ou a listagem bateu com o esperado: 2 NCMs `OK`, 2 POs aplicadas e 77 + 2 + 4 pendências. Resultado: "PO sem fornecedor" de 3 para 1, "NCM não cadastrada" de 3 para 1 e pendências abertas da carga de 174 para 91 (86 `MISSING_PO`, 2 `INVALID_DATE`, 1 `PO_IP_SUPPLIER_DIVERGENCE`, 1 `PO_WITHOUT_SUPPLIER`, 1 `PRICE_WITHOUT_CURRENCY`). A auditoria registrou 2 `QUALITY_FIX` de PO, 4 `CREATE` de catálogo e 83 `RESOLVE`. O outbox registrou os eventos correspondentes: 2 de PO, 2 `catalog.entry.created` e 83 `quality.issue.resolved`. A repetição respondeu `replayed` ou `200` sem alterar nada. Backup antes da gravação: `/var/backups/import-erp/erp_po_totvs_hml_pre_quality_resolve_20261104T172158Z.dump` (473.012.424 bytes, SHA-256 `d20f18ed1ecd7b2dc04d7a3026ad2a8dd5eea4eaf449bc3a923c2966ed42db5a`, 59 tabelas com dados). Scripts e logs em `/root/claude-currency-20261104` na VPS. Sem mudança de código, migration, produção, `main` ou variáveis da Vercel.

## Moeda por ensaio estatístico nos itens com preço sem moeda do HML (2026-11-04)

Com autorização do usuário, os 77 itens da regra "Preço sem moeda" (5 POs `ACTIVE`, 76 da HEXING e 1 da INFOVISTA) receberam a moeda definida por um ensaio estatístico, em transação somente leitura, sobre os itens com moeda do `erp_po_totvs_hml` (7.453 em CNY e 19 em USD; nenhum em BRL ou EUR). O cadastro de fornecedor não tem país, então a localidade não pôde ser testada diretamente; o fornecedor exato a substitui:

- a moeda é da PO: nenhuma das 365 POs com moeda tem duas moedas;
- cada fornecedor usa uma única moeda. Em CNY ficam HEXING (230 POs), ZLINK, NANJING HEXING e LIVOLTEK; em USD, EVE ASIA, HUBBELL (BECHWITH), D-FLOW e LONGMIX - HEXING. O nome parecido não serve, porque LONGMIX - HEXING fatura em USD;
- a validação deixando a PO de fora acertou 7.454 de 7.454 itens pelo fornecedor, inclusive os 17 em USD. Pelo produto, acertou só 6 de 17 em USD, porque a EVE ASIA vende em USD os mesmos códigos que HEXING e ZLINK vendem em CNY;
- o preço confirma a moeda. Comparado à mediana CNY do mesmo produto em outras POs, o item em CNY tem razão mediana 1,00 (p10–p90 0,78–1,17) e o item em USD tem 0,129 (0,10–0,15), sem sobreposição. Nos itens sem moeda com histórico, a razão mediana foi 0,95.

Gravação por `POST /api/v1/quality/current/fixes` (`ITEM_CURRENCY`, moeda explícita) do `dist` de `hml-release-e830415`, com o ator Master Francisco Matheus, chamada por `apply-currency-plan.mjs`. O script monta o plano a partir da regra da tela e recusa contagem, fornecedor ou status diferentes do ensaio. Foram três chamadas:

| Chave | POs | Itens | Moeda | Evidência |
|---|---|---|---|---|
| `moeda-estatistica-20261104-CNY-alta` | 029078, 030201, 031178 | 62 | CNY | Fornecedor e preço; os IPs de 029078 e 030201 têm total em CNY na aba Pós |
| `moeda-estatistica-20261104-CNY-media` | 031047 | 14 | CNY | Só o fornecedor: são peças de máquina sem histórico de preço |
| `moeda-planilha-20261104-USD` | 031462 | 1 | USD | A planilha informa `US$`; a carga só aceitava o código ISO |

A prévia aplicou 77 sem recusa e manteve as pendências. A gravação zerou a regra, incrementou uma vez a versão de cada PO e registrou 77 linhas `QUALITY_FIX` em `audit.audit_log`, com o motivo `Moeda definida pelo ensaio estatístico de moeda de 2026-11-04…`, e os 77 eventos ligados em `audit.outbox_message` (`correlation_id` = `event_id`). A repetição respondeu `replayed` sem alterar nada. Ficou sem moeda só o item cancelado HXWSG100R22014-CEMIG da PO 030201, que a regra não conta. Seguem para conferência manual o preço do 5041400670 na PO 031178 (4,62 contra a mediana de 0,0585 em CNY, 79 vezes mais) e 4 itens da mesma PO com razão entre 0,26 e 0,36, abaixo do histórico mas longe do padrão de USD. Backup antes da gravação: `/var/backups/import-erp/erp_po_totvs_hml_pre_currency_statistical_20261104T165639Z.dump` (472.995.406 bytes, SHA-256 `c3b67f1ae6dd0f536a020a1d2aaff1742977a1b4b7fc6ae2f6c50ae40b83b577`, 59 tabelas com dados). Scripts, plano e logs em `/root/claude-currency-20261104` na VPS. Sem mudança de código, migration, produção, `main` ou variáveis da Vercel.

## Produtos sem cadastro no HML (2026-11-04)

Os 388 itens da regra "Produto sem cadastro" (370 códigos, todos em PO `ACTIVE`, quase todos HEXING/Livoltek) foram comparados com os 1.529 produtos globais em busca de erro de digitação: um caractere trocado, a mais ou a menos, inversão, separador ou sufixo, conferindo a descrição. Não houve erro a corrigir: 125 códigos têm um código cadastrado a um caractere de distância, mas são peças irmãs da numeração sequencial da Livoltek (por exemplo 2010105550, resistor 10R 50 ppm, e 2010105560, 10R 200 ppm); 205 descrições citam o próprio código e as outras 154 não têm produto cadastrado equivalente. A PO 032362 usa códigos de 12 dígitos (base de 10 mais "01" ou "02") em 9 de 12 linhas, padrão da própria PO; em 302031213901 e 302013154901 a base (3020312139 e 3020131549) já está cadastrada, e Compras deve confirmar se é o mesmo produto. Os códigos dos itens não foram alterados, porque a PO vem do Protheus.

Com aprovação do usuário e o perfil Master de Francisco Matheus, `register-products.mjs` cadastrou os 370 produtos em uma chamada de `POST /api/v1/products/bulk` do `hml-release-e830415` (código do item e a descrição mais frequente das suas linhas). A conferência prévia validou o lote contra os limites da rota e não encontrou código já cadastrado. Resultado: 370 criados, 370 linhas de auditoria, outbox e alias, 1.899 produtos globais ativos e "Produto sem cadastro" em 0; a repetição respondeu 370 ignorados. Backup antes do cadastro: `/var/backups/import-erp/erp_po_totvs_hml_pre_product_register_20261104T145104Z.dump` (472.825.797 bytes, SHA-256 `dc2e2b2cc6441a13663446d594de5765c644d06c93a4f88ede81f2d4432f76df`, 59 tabelas com dados).

Em seguida, `fill-product-ncm.mjs` preencheu a NCM de 356 desses produtos com a NCM única das suas linhas de PO vivas, numa transação, com o mesmo comando e a mesma auditoria da opção "também no produto" da correção da Qualidade (só NCM vazia, `QUALITY_FIX` em `audit.audit_log` e outbox). Ficaram sem NCM 11 produtos cujas linhas não têm NCM e 3 cujas linhas usam NCM fora do cadastro (os 3 casos em revisão da regra "NCM não cadastrada"); nenhum tinha mais de uma NCM. 560 produtos têm NCM no cadastro, e a repetição não alterou nada. Backup antes: `/var/backups/import-erp/erp_po_totvs_hml_pre_product_ncm_20261104T162144Z.dump` (472.940.683 bytes, SHA-256 `f1c656cc2935177d21a672a997b1908f517eb880f9dd482a98fdd8a040a46f22`, 59 tabelas com dados).

## NCM não cadastrada: cadastro e substituição no HML (2026-11-04)

Com aprovação do usuário, os 48 itens da regra "NCM não cadastrada" foram analisados contra a tabela oficial persistida no HML e contra as outras linhas do mesmo produto. 36 tinham NCM que não existe mais na tabela vigente: extinções de 2022 (8532.23.00, 8517.70.99, 8517.70.29, 7419.80.00, 9403.20.00, 7315.11.00) ou erros de digitação (8605.50.10, 8717.62.41, 8528.33.00, 9039.90.90, 8535.30.20, 3824.99.99). 12 tinham NCM oficial e vigente ainda não cadastrada.

Com o perfil Master de Francisco Matheus, `register-ncms.mjs` cadastrou pela rota oficial 7 NCMs, sem consultar o Siscomex: 7212.30.00, 3907.30.22, 8301.40.00, 8473.30.90 e 8543.90.90, que estavam corretas nos seus 7 itens, e as sucessoras 7315.11.90 e 8524.91.00. Em seguida, `apply-ncm-replace.mjs` substituiu a NCM de 38 itens (27 de confiança alta e 11 média), 32 deles em 15 POs `CLOSED`, numa transação por PO. Cada item só muda se ainda tiver a NCM antiga esperada e a nova estiver `ACTIVE`; a PO encerrada é reaberta e encerrada de novo com status, data, autor e motivo originais, e não é reaberta sem item pendente. A auditoria guarda a NCM anterior e a nova, com o motivo `NCM substituída na análise da regra "NCM não cadastrada" de 2026-11-04: <justificativa>`. A base de cada substituição foi a NCM das outras linhas do produto (por exemplo 8532.24.20 para os capacitores multicamadas PTH, 8541.60.10, 8541.10.22, 8542.31.20, 8542.39.91, 8535.30.18 e 8506.50.10) ou a sucessora oficial (8517.79.00, 8517.71.90, 7419.80.90, 9403.20.90, 7315.11.90); 8504.90.30 passou a 8504.90.90 (parte de carregador) e 8524.92.00 (OLED) passou a 8524.91.00 (TFT). O ensaio com ROLLBACK aplicou 38 sem recusa. Depois da gravação, "NCM não cadastrada" ficou em 3 (shunt 3010503390 com 9030.33.21, secador de ar 7020705690 com 8419.39.00 e endurecedor 4050302380 com 3824.99.99, que dependem de decisão fiscal ou da composição), 204 produtos têm NCM, os encerramentos das 15 POs ficaram iguais e a repetição não alterou nada. Planilha da análise em `analise_ncm_nao_cadastrada.xlsx` (scratchpad da sessão); scripts e logs em `/root/claude-ncm-20261104` na VPS. Backup antes do cadastro: `/var/backups/import-erp/erp_po_totvs_hml_pre_ncm_replace_20261104T143335Z.dump` (472.804.244 bytes, SHA-256 `e387cd518904adc729cc258e7c5b5bf06396803c05dfd6c504ab59a8be342cdb`, 59 tabelas com dados).

## NCM por análise estatística nos itens sem NCM do HML (2026-11-04)

Com autorização do usuário, 202 dos 484 itens sem NCM receberam a NCM sugerida por uma análise estatística sobre os demais itens do `erp_po_totvs_hml`, a única fonte de NCM do banco (nenhum produto do cadastro tinha NCM). Dois métodos, validados escondendo a NCM de cada produto que já a tinha:

- mesmo produto: maioria das NCMs das outras linhas do mesmo código (89,4% de acerto nos 8 dígitos). A regra da tela exige NCM única, mas 411 dos 1.525 produtos com NCM têm mais de uma, quase sempre uma dominante e erros pontuais;
- combinação de mesma descrição, família pelo prefixo do código e descrição parecida (TF-IDF, 7 vizinhos), para produtos sem NCM em nenhuma linha (76,0% no geral, 94,5% com confiança ≥ 0,80).

Entraram somente os itens da faixa alta (confiança ≥ 0,80), em PO `ACTIVE` e com NCM `ACTIVE` no cadastro: 94 pelo mesmo produto e 108 pela combinação, em 47 chamadas de `POST /api/v1/quality/current/fixes` (`ITEM_NCM`, uma NCM por chamada, `alsoProduct`, chave `ncm-estatistica-20261104-<ncm>-<método>`), feitas pelo `dist` de `hml-release-e830415` com o ator Master Francisco Matheus. A prévia aplicou 202 sem recusa e manteve as pendências; a gravação deixou "item sem NCM" em 282, preencheu a NCM de 96 produtos do cadastro e registrou 298 linhas em `audit.audit_log` e `audit.outbox_message` com o motivo `NCM sugerida pela análise estatística de 2026-11-04…`. A repetição respondeu `replayed` sem alterar nada. Ficaram de fora 36 itens da faixa alta em PO `CLOSED` (a rota recusa) e 1 com NCM fora do cadastro; as faixas média (77) e baixa (168) ficam para revisão do fiscal.

Backup antes da gravação: `/var/backups/import-erp/erp_po_totvs_hml_pre_ncm_statistical_20261104T131126Z.dump` (472.546.650 bytes, SHA-256 `b6c2d6b67f87664055f634c09c40aa1716be57e719b9b5bbdd0d201ee1bc5c38`, 59 tabelas com dados no `pg_restore --list`). Script, plano e logs em `/root/claude-ncm-20261104` na VPS. Sem mudança de código, migration, produção, `main` ou variáveis da Vercel.

Na segunda etapa, por decisão do usuário (dado histórico, sem revisão do fiscal), entraram mais 111 itens: o restante da faixa alta e toda a faixa média (confiança 0,60–0,80, 69,7% de acerto nos 8 dígitos e 82,9% nos 4), em POs ativas e encerradas. A faixa baixa (168 itens, 33,7% de acerto) não foi gravada. Os 56 itens de PO ativa foram pela rota, com chave `ncm-estatistica-20261104b-<ncm>-<método>-<faixa>` e a faixa e a confiança mínima no motivo. Os 55 itens de 12 POs `CLOSED` foram gravados por `apply-ncm-stage2.mjs`, uma transação por PO: reabre a PO, grava a NCM do item e do produto vazio com `record` (auditoria e outbox como na rota), encerra de novo com status, data, autor e motivo originais e confere que eles voltaram iguais; nenhum gatilho foi desativado. Ensaio com ROLLBACK: 111 aplicados, nenhuma recusa, nenhum produto com NCM diferente no cadastro. Depois da gravação, "item sem NCM" ficou em 171 (144 em PO ativa e 27 em encerrada: 168 da faixa baixa e 3 cuja NCM sugerida, 8536.10.00 ou 8534.00.51, ainda não está no cadastro), 153 produtos têm NCM, e os encerramentos das 12 POs ficaram idênticos aos de antes. A repetição de conferência foi rodada com uma versão do script que ainda reabria POs sem item pendente: ela não gravou item, mas deixou 12 registros de auditoria `QUALITY_FIX` da PO com `reopenedForNcmItems: 0` e mais uma versão nessas POs; o script foi corrigido para não reabrir sem pendência. Backup antes da segunda etapa: `/var/backups/import-erp/erp_po_totvs_hml_pre_ncm_statistical_stage2_20261104T132835Z.dump` (472.592.336 bytes, SHA-256 `720956f0d9d351f604426a80033fb53b93912c0a649f0ff4f02749210c7b7172`, 59 tabelas com dados).

Os 168 itens da faixa baixa foram revisados um a um (descrição técnica, tabela oficial de NCM do HML, família do código e produtos parecidos). Antes, o procedimento foi calibrado às cegas em 34 produtos difíceis com NCM confiável no histórico, sem que a amostra mostrasse evidência de si mesma: 71% de acerto nos 8 dígitos e 82% nos 4, contra 41% e 68% do método estatístico nos mesmos produtos. Resultado: 67 itens com confiança alta, 75 média, 18 baixa e 8 sem sugestão (descrição só com o código, "Panel" e um serviço de suporte de software, que não tem NCM). Foram gravados os 124 de confiança alta ou média com NCM `ACTIVE` no cadastro (114 em PO ativa pela rota, chave `ncm-revisao-20261104-<ncm>-<confiança>`, e 10 em 6 POs `CLOSED` por `apply-ncm-review.mjs`, que reabre e encerra de novo a PO e só reabre se houver item pendente), com o motivo `NCM definida pela revisão item a item de 2026-11-04…`. O ensaio com ROLLBACK aplicou 124 sem recusa; depois da gravação, "item sem NCM" ficou em 47 (30 em PO ativa e 17 em encerrada), 174 produtos têm NCM, os encerramentos das 6 POs ficaram iguais (só a versão subiu) e a repetição não alterou nada. Ficaram pendentes 21 itens cuja NCM revisada ou sugerida ainda não estava no cadastro (14 NCMs), 18 de confiança baixa e 8 sem sugestão. Backup antes da gravação: `/var/backups/import-erp/erp_po_totvs_hml_pre_ncm_item_review_20261104T135231Z.dump` (472.622.233 bytes, SHA-256 `f635d9070f12698443e6c254fcdf931e0a23b7eb4a76100fd746877913bbea26`, 59 tabelas com dados).

Por pedido do usuário, as 14 NCMs (3917.23.00, 3917.39.00, 4901.99.00, 7307.29.00, 8205.40.00, 8424.10.00, 8426.99.00, 8504.31.93, 8504.40.30, 8516.79.90, 8523.51.10, 8534.00.51, 8536.10.00 e 8542.33.90) foram cadastradas com o perfil Master de Francisco Matheus por `POST /api/v1/ncms/import-official` do `hml-release-e830415`, chamado por `register-ncms.mjs` (chave `ncm-cadastro-20261104-<código>`), a partir da cópia do catálogo Siscomex persistida no HML (sincronizada em 2026-11-04 06:01): o Siscomex não foi consultado. Todas estavam vigentes e com vigência informada; a auditoria registrou 28 linhas `CREATE` (registro e atributos). Em seguida, os 21 itens receberam a NCM: 18 da revisão (4 na PO `CLOSED` 025307) e 3 da análise estatística, faixa alta (2 na PO `CLOSED` 024130). Ensaio com ROLLBACK sem recusa; depois da gravação, "item sem NCM" ficou em 26 (15 em PO ativa e 11 em encerrada: 18 de confiança baixa e 8 sem sugestão), 185 produtos têm NCM, os encerramentos das POs 024130 e 025307 ficaram iguais e a repetição não alterou nada. Backup antes do cadastro: `/var/backups/import-erp/erp_po_totvs_hml_pre_ncm_register_20261104T140636Z.dump` (472.646.621 bytes, SHA-256 `be6c8af8775f93b0eb319befb4558e6ff161a48f2a5eb877180e00bfaf1d9c7f`, 59 tabelas com dados).

Incidente durante essa tarefa: a primeira versão de `register-ncms.mjs` carregava o catálogo oficial inteiro (10.516 NCMs com atributos) pelo provedor persistido num segundo processo Node, que chegou a 2,1 GB. Às 11:03:02 o kernel o encerrou por falta de memória e, no mesmo momento, os containers `postgres_postgres` e `airflow_airflow-postgres` foram parados pelo Swarm e recriados. O PostgreSQL (HML, produção `erp_po_totvs_test` e os bancos dos outros serviços) ficou indisponível de 11:03:01 a 11:03:56, com desligamento limpo e sem recuperação de falha; nenhum dado foi gravado por essa tentativa. Depois disso, os workers de exportação de produção e do HML se reconectaram (11:04:00 e 11:04:11), `/health/live` respondeu 200 nas duas APIs e não houve novo erro nos serviços. O script passou a ler só os códigos pedidos e rodou com `--max-old-space-size=256`.

## Correções de cadastro pela Qualidade no HML (2026-11-03)

Os commits `4282ef8` (API) e `e830415` (web) fazem a entrega 3 de `docs/PLANO_QUALIDADE_DADOS.md`: `POST /api/v1/quality/current/fixes` corrige moeda, preço, NCM do item (e do produto, se vazia) e fornecedor da PO de 1 a 500 registros, com prévia que sempre termina em ROLLBACK; produto e NCM oficial usam as rotas de cadastro existentes. Não há migration. A tela nova chama a rota nova; por isso a API foi publicada antes do push.

O release `/opt/import-erp/apps/api/hml-release-e830415` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-669f838` (dependências e lockfile iguais), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-e830415.conf`; o worker foi movido com `enable-homologation-export-worker.sh e830415`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-quality-fixes-e830415-predeploy`. Rollback somente do código: remova o drop-in `e830415`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-669f838`) e rode `enable-homologation-export-worker.sh 669f838`. `/health/live` respondeu 200 e a rota sem sessão respondeu 401.

Antes da ativação, `test/quality-fixes-hml.integration.mjs` rodou a prévia sobre todos os erros reais, sem gravar nada: moeda — 77 itens, 76 com a moeda sugerida (CNY) e 1 sem sugestão; NCM — 484 itens, 54 com NCM sugerida por outros itens do mesmo produto, 82 em PO encerrada e 348 sem sugestão; fornecedor — 3 POs, todas corrigíveis. `test/quality-rules-hml.integration.mjs` continuou passando. Nenhuma correção foi gravada no HML. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Regras sobre os dados atuais e dispensas (M077) no HML (2026-11-03)

Os commits `69a990b` (API), `669f838` (web) e `d055235` (teste HML) fazem a entrega 2 de `docs/PLANO_QUALIDADE_DADOS.md`: 12 regras calculadas na leitura (`GET /api/v1/quality/current`) e dispensas "dado correto" (`POST /api/v1/quality/current/waivers` e `.../waivers/:id/revoke`) em `migration.quality_rule_waiver` (M077). A aba "Dados atuais" depende da rota nova; por isso a API foi publicada antes do push.

Backup antes da M077: `/var/backups/import-erp/erp_po_totvs_hml_pre_m077_20261103T231220Z.dump` (472.481.755 bytes, SHA-256 `68f73b060bf981657b2df4cdec9fa13df792d85a72eedc673afea7c4a670174b`, 58 tabelas com dados no `pg_restore --list`). M077 foi ensaiada com ROLLBACK e aplicada numa transação que recusa outro banco ou ledger diferente de 76, com checksum LF `a58bfd0c7c2e9f17afb0709ffed1b04776130da28fd585fccb0966e134f65ec7`; ledger 77/77 e `import_erp_hml_app` com `SELECT, INSERT, UPDATE` na tabela nova.

O release `/opt/import-erp/apps/api/hml-release-669f838` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-ffe90f0` (dependências e lockfile iguais; o `package.json` só mudou nos scripts de teste), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-669f838.conf`; o worker foi movido com `enable-homologation-export-worker.sh 669f838`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-quality-rules-669f838-predeploy`. Rollback somente do código: remova o drop-in `669f838`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-ffe90f0`) e rode `enable-homologation-export-worker.sh ffe90f0`; a M077 é aditiva e pode ficar. `/health/live` respondeu 200 e `GET /api/v1/quality/current` sem sessão respondeu 401.

`test/quality-rules-hml.integration.mjs` (`MIGRATION_ENV=isolated`, `--env-file=/etc/import-erp/homologation-db.env`) passou: as contagens das 12 regras bateram com consultas independentes (item sem NCM 484, NCM não cadastrada 57, produto sem cadastro 388, preço sem moeda 77, item sem preço 2, PO sem fornecedor 3, PO aprovada antes da SC 64, desembaraço antes da chegada 33, IP sem PO 2, item embarcado sem IP 1, IP com fornecedor diferente da PO 0, SC com mais de um fornecedor 0), e 10 regras tiveram caso negativo e positivo numa transação sempre desfeita. "PO sem fornecedor" não aceita a alteração de teste (o banco recusa com `23514`; uma PO com SC recebe o fornecedor da SC pelo gatilho da M041) e "SC com mais de um fornecedor" não tem caso no HML; as duas ficaram cobertas pela contagem. Nenhuma dispensa foi gravada. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Qualidade dos dados mais clara no HML (2026-11-03)

Os commits `1ba865b` (web) e `ffe90f0` (API) fazem a entrega 1 de `docs/PLANO_QUALIDADE_DADOS.md`: `GET /api/v1/data-issues` aceita `search` (até 80 caracteres, procurado no texto da evidência) e devolve `countsByCode` e `links` (PO pela observação da linha de origem, IP pelo `ipNumber` da evidência, só com correspondência única no escopo). A rota de resolução não mudou. Não há migration, e o web novo funciona com a API anterior (sem resumo por tipo).

Antes do deploy, o SQL gerado pela rota rodou no `erp_po_totvs_hml` em transação somente leitura: Master com `status=open` devolveu 174 pendências (86 `MISSING_PO`, 78 `PRICE_WITHOUT_CURRENCY`, 4 `SC_MULTIPLE_SUPPLIERS`, 3 `PO_WITHOUT_SUPPLIER`, 2 `INVALID_DATE`, 1 `PO_IP_SUPPLIER_DIVERGENCE`), 87 com link de PO e 67 com link de IP; o escopo `ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L` devolveu 87.

O release `/opt/import-erp/apps/api/hml-release-ffe90f0` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR; SHA-256 do pacote `8d84e7ad…e6e7`), reaproveitando o `node_modules` de `hml-release-d47d9ca` (`package.json` e lockfile iguais, conferidos com `cmp`), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-ffe90f0.conf`; o worker foi movido com `enable-homologation-export-worker.sh ffe90f0`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-quality-clarity-ffe90f0-predeploy`. Rollback somente do código: remova o drop-in `ffe90f0`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-d47d9ca`) e rode `enable-homologation-export-worker.sh d47d9ca`. `/health/live` respondeu 200 e `GET /api/v1/data-issues` sem sessão respondeu 401. O Preview do commit `ffe90f0` ficou `success` no status da Vercel no GitHub. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Data do plano comercial no HML (2026-10-30)

Regras em `docs/PLANO_CARGA_HISTORICA_PLANILHA.md`. `import-commercial-plan-dates.py` não conecta ao banco: lê a aba `Status PO's` de `FUP POS - MRP.xlsx` (SHA-256 `af53694122423aedcbe34649e4062a605081427fc56b0e901fabf31ef98544bf`) e gera um SQL que recusa outro banco, recusa repetir e não substitui datas gravadas. `--expected-items` é obrigatório, e qualquer outro total de linhas interrompe a carga. Sem `--commit`, termina em `ROLLBACK`.

Depois do ensaio com ROLLBACK, a carga gravou 127 SCs e 6.258 linhas, com a release `hml-release-eb6edfa`, sem mudar a API nem o web. `verify-commercial-plan-dates.mjs`, `verify-follow-up-load.mjs` e `accept-follow-up-load.mjs` passaram, e `cleanup` retirou os resíduos do aceite. A repetição foi recusada com `ALREADY_PROMOTED`. Na reconferência, passe o relatório da carga do plano como segundo argumento de `verify-follow-up-load.mjs`, porque a SC 020328 foi criada depois da carga do Follow Up.

| Momento | Arquivo em `/var/backups/import-erp/` | Bytes | SHA-256 |
|---|---|---|---|
| Antes da carga | `erp_po_totvs_hml_pre_commercial_plan_20261030T185958Z.dump` | 474.150.793 | `aa688d4cc6d8cae36f8308a7b384df22e477e47f1add4e8c809a69a276466e8b` |
| Depois da carga | `erp_po_totvs_hml_post_commercial_plan_20261030T185958Z.dump` | 476.279.088 | `afd238969852ad4ef06af3487c40ea3a2536c52a5975dc5c7cc2ef3e954e08b9` |
| Antes da data pela PO | `erp_po_totvs_hml_pre_plan_by_po_20261030T202414Z.dump` | 476.279.092 | `479d1ed403a92b056c36c6c091e6d169f4b691c3eee3930bd4c54783a6180086` |
| Depois da data pela PO | `erp_po_totvs_hml_post_plan_by_po_20261030T202414Z.dump` | 478.261.136 | `c694d9d56e56ea323eb3c9eac96a7fd62784b366c48ee7744bdd898dd510cb75` |

O segundo passo, `--by-po`, exige `--expected-requests`, recusa rodar antes do primeiro e recusa repetir. Com ele, o HML ficou com 144 SCs e 6.299 linhas com data. O ensaio com ROLLBACK, as conferências e o aceite passaram na release `hml-release-d47d9ca`, ativada por drop-in com a regra do T0 (necessidade − 4 meses + 4 dias), e o worker foi movido com `enable-homologation-export-worker.sh d47d9ca`. Drop-ins e `ExecStart` anteriores estão em `/var/backups/import-erp/hml-follow-up-load-d47d9ca-predeploy`.

## Carga histórica da planilha Follow Up no HML (M075, M076) (2026-10-30)

Regras e resultado em `docs/PLANO_CARGA_HISTORICA_PLANILHA.md`. A planilha `Follow Up Import 2026 - atualizado .xlsx` (SHA-256 `a913434489b8ba9af81803bcd0661b4cc7aa212206a3d0fbb6d1dbacd3e315bc`, abas Pré `B:BA` e Pós `B:AN`) foi carregada no `erp_po_totvs_hml`, com autorização do usuário para apagar a simulação (16 POs, 703 itens, 22 IPs, documentos, alocações e 2 SCs). O histórico de auditoria da simulação e os cadastros foram mantidos.

`import-follow-up-workbook.py` não conecta ao banco: lê a planilha e uma exportação do cadastro, gera um SQL e um relatório. O SQL roda numa transação pelo `psql` como `postgres` dentro do container, recusa outro banco, exige a M075 e recusa repetir o mesmo hash. Sem `--commit` ele termina em `ROLLBACK`, com todos os gatilhos ativos. O ensaio com ROLLBACK revelou uma linha com moeda e sem preço, corrigida antes da carga. A carga levou 8 s.

Backups custom, validados com `pg_restore --list` (58 tabelas com dados):

| Momento | Arquivo em `/var/backups/import-erp/` | Bytes | SHA-256 |
|---|---|---|---|
| Antes da M075 | `erp_po_totvs_hml_m075_20261030T135015Z.dump` | 467.433.803 | `4f791e439a423bcc1ca9e6d15a705fbcf4ea3f3f2a4194bcf3daf071a9a65428` |
| Antes da carga | `erp_po_totvs_hml_pre_follow_up_load_20261030T135918Z.dump` | 467.435.676 | `74ef4fff0a326b7c8075dbe4a39b9ec453cba83e82c9af9cc4088f7f22779911` |
| Depois da carga | `erp_po_totvs_hml_post_follow_up_load_20261030T140731Z.dump` | 472.258.632 | `72a541f20808872951bf263b673978587255f5fc30a25229cab96e16040876e7` |

M075 foi ensaiada com ROLLBACK e aplicada numa transação que recusa outro banco ou ledger diferente de 74, com checksum LF `62e5390b52cac55645acd23c50292f5e9cfc214a23d514dd7533fad553fe5d20`. M076 foi aplicada do mesmo modo, com checksum LF `b7b15afd7542399bb1ef5aca0996e758e90d7fcdef6fb82801917ff420efa699`; ledger 76/76.

O release desta carga foi `/opt/import-erp/apps/api/hml-release-eb6edfa`, montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR), reaproveitando o `node_modules` do release anterior (lockfile igual) e ativado por drop-in; o worker foi movido com `enable-homologation-export-worker.sh eb6edfa`. Drop-ins e `ExecStart` anteriores de cada troca estão em `/var/backups/import-erp/hml-follow-up-load-<sha>-predeploy`. Rollback do banco: restaurar `..._pre_follow_up_load_...dump`, que volta a simulação. Rollback só do código não é possível para antes de `a2c62b1`: o web e a API novos usam `documentsOkDate`.

`/health/live` respondeu 200 e as rotas sem sessão responderam 401. Para reconferir, rode a partir de uma pasta com os scripts:

```sh
ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env verify-follow-up-load.mjs load-report.json
MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env accept-follow-up-load.mjs
```

O aceite altera e desfaz dados pelas rotas reais; depois dele, remova a alocação cancelada de teste e as observações de preço e descrição cujo `actor_id` não seja `migration:follow-up-load`. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Quantidade da invoice por PO e código no HML (2026-10-29)

Os commits `7c59c6c` e `744273b` implementam a etapa 2 de `docs/PLANO_INVOICE_DISTRIBUICAO_POS.md`: cada linha da invoice só vai para o item com o mesmo código na PO citada (a API recusa outro código com `INVOICE_PRODUCT_CODE_MISMATCH`), a quantidade destinada pode diferir da invoice só com confirmação e motivo em `lineDecisions`, e a rota de lote informa `otherImporters`. Não há migration. O web novo envia `lineDecisions`, que a API anterior recusava; por isso a API foi publicada antes do push.

O release `/opt/import-erp/apps/api/hml-release-744273b` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR; SHA-256 do pacote `f53d6b52…8b14`), reaproveitando o `node_modules` de `hml-release-5615d9b` (`package.json` e lockfile iguais, conferidos com `cmp`), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-744273b.conf`; o worker foi movido com `enable-homologation-export-worker.sh 744273b`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-invoice-distribution-744273b-predeploy`. Rollback somente do código: remova o drop-in `744273b`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-5615d9b`) e rode `enable-homologation-export-worker.sh 5615d9b`; a web nova precisa voltar junto, porque envia `lineDecisions`. `/health/live` respondeu 200; `POST /api/v1/processes/import-invoice` e `POST /api/v1/purchase-orders/invoice-candidates/batch` sem sessão responderam 401. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Invoice sem alterar a PO no HML (2026-10-29)

O commit `5615d9b` segue a etapa 1 de `docs/PLANO_INVOICE_DISTRIBUICAO_POS.md`: a carga da invoice deixa de alterar o item da PO (a API recusa `catalogUpdates.poItems` com `INVOICE_PO_ITEM_UPDATE_NOT_ALLOWED`) e só completa NCM e dados do fabricante vazios no cadastro do produto. Não há migration. O web novo não envia `poItems`, que a API anterior exigia; por isso a API foi publicada antes do push.

O release `/opt/import-erp/apps/api/hml-release-5615d9b` foi montado com `git -c core.autocrlf=false archive` (nenhuma fonte com CR), reaproveitando o `node_modules` de `hml-release-32ad8e3` (dependências iguais), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-5615d9b.conf`; o worker foi movido com `enable-homologation-export-worker.sh 5615d9b`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-invoice-po-reference-5615d9b-predeploy`. Rollback somente do código: remova o drop-in `5615d9b`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-32ad8e3`) e rode `enable-homologation-export-worker.sh 32ad8e3`. `/health/live` respondeu 200 e `POST /api/v1/processes/import-invoice` sem sessão respondeu 401. O Preview `erp-comex-m3aly6sy3` (branch `homologacao`, commit `5615d9b`) ficou `Ready`. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Unidades equivalentes e apelidos de Exporter (M074) no HML (2026-10-29)

Os commits `5bc6105` (unidades), `6135752` (API, M074), `a97ea01` (correspondência na carga da invoice) e `32ad8e3` (web) seguem `docs/PLANO_INVOICE_UNIDADES_APELIDOS.md`. Unidades do mesmo grupo (peça `UN/PC/PCS…`, quilo `KG/KGS`, metro `M/MT/MTS`) deixam de pedir confirmação na carga da invoice. Cada fornecedor global ganha apelidos de Exporter (`GET|POST /api/v1/suppliers/:id/exporter-aliases`, `POST …/:aliasId/remove`; escrita por Master, Administrador e Compras). O Exporter corresponde ao fornecedor da PO quando começa com um apelido ativo desse fornecedor, e então o IP grava o fornecedor do cadastro sem a marca de divergência.

Antes da migration, o HML estava em M001–M073. Backup custom pré-M074: `/var/backups/import-erp/erp_po_totvs_hml_m074_20261029T171136Z.dump`, 467.213.632 bytes, SHA-256 `c085caa6eec324fd067b66062be23fbe85d999f9bd7356d225d51bca1e1b5ff8`, validado com `pg_restore --list` (57 tabelas com dados). A M074 foi ensaiada com ROLLBACK: as consultas da carga (`FOR UPDATE OF item, po`) e da rota de candidatos (`GROUP BY`) leram os apelidos, e apelido curto, repetido, de não fornecedor, remoção sem metadados e reativação foram recusados. Depois foi aplicada como `postgres` numa transação que recusa outro banco ou ledger diferente de 73, com checksum LF `b36ddcd03dcefb42640f9e9dacefb02a50fb1ab56671120a0b5b1cb57f2c90b8`; ledger 74/74.

O release `/opt/import-erp/apps/api/hml-release-32ad8e3` foi montado com `git -c core.autocrlf=false archive`, reaproveitando o `node_modules` de `hml-release-3ff4bb6` (dependências e lockfile iguais), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-32ad8e3.conf`; o worker foi movido com `enable-homologation-export-worker.sh 32ad8e3`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-exporter-alias-32ad8e3-predeploy`. Rollback somente do código: remova o drop-in `32ad8e3`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-3ff4bb6`) e rode `enable-homologation-export-worker.sh 3ff4bb6`; a M074 pode permanecer. `/health/live` respondeu 200 e a rota de apelidos sem sessão respondeu 401. O Preview `dpl_BdaLezq47JsVQJ7f1Ntun3yDoRyK` (branch `homologacao`, commit `32ad8e3`) ficou `Ready` no alias estável.

Dados de aceite: a PO 030201 da simulação está toda distribuída nos IPs `030201-A`…`G`, então `seed-hml-iph034a-acceptance.mjs apply` criou pela API uma PO 030201 separada na importadora `ELETRA INDUSTRIA E COMERCIO( GALPAO-FORTALEZA )` (id `64ec9a4b-f2f1-4833-bfac-2299cfbd714a`), com os 196 produtos da IPH034A, fornecedor EX000135 e as descrições e preços da PO da simulação. A rota de candidatos do release, passada pelas funções da tela, deu para as 196 linhas: nenhum destino com problema, nenhum ponto de unidade e nenhum de código; 196 pontos de fornecedor sem apelido e 0 com o apelido `HEXING ELECTRICAL CO.,LTD`. Restam 135 pontos de preço, porque os preços da invoice diferem dos da PO 030201 (106 acima de 0,01%). Nenhum apelido foi cadastrado e a invoice não foi carregada: isso fica para o teste no Preview. Para desfazer, rode o script com `revert`. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Indicadores sem POs e IPs excluídos no HML (2026-10-28)

Os commits `d04daa4` (API) e `3ff4bb6` (web) corrigem `GET /api/v1/reports/summary`. A rota contava todas as POs e todos os IPs das importadoras do usuário, inclusive os excluídos: no HML eram 15 POs, das quais 13 estavam `DELETED`, e 21 IPs, dos quais 12 estavam `DELETED`. Agora ela segue as listas operacionais. Ficam de fora as POs com `lifecycle_status = 'DELETED'` e os IPs com `record_status = 'DELETED'`. Um item só conta como vinculado se a alocação estiver `ACTIVE` e o IP de destino também. A tela passou a traduzir os status nas duas listas. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-3ff4bb6` foi montado com `git -c core.autocrlf=false archive` (sem CR nas fontes) e reaproveita o `node_modules` de `hml-release-fbd0ef4`, porque `package.json` e `pnpm-lock.yaml` são iguais. Ele foi compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-3ff4bb6.conf`, e o worker foi movido com `enable-homologation-export-worker.sh 3ff4bb6`. Os drop-ins e o `ExecStart` anteriores estão em `/var/backups/import-erp/hml-reports-deleted-3ff4bb6-predeploy`. Para reverter só o código: remova o drop-in `3ff4bb6`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-fbd0ef4`) e rode `enable-homologation-export-worker.sh fbd0ef4`.

Após o restart, `/health/live` respondeu 200 e `/api/v1/reports/summary` sem sessão respondeu 401. A rota do release foi chamada pelo próprio Fastify contra o HML, com `import_erp_hml_app` e `default_transaction_read_only=on`, abrangendo todas as importadoras. Resultado no pré-embarque: 2 POs, 274 itens, todos vinculados. No pós-embarque: 10 IPs, sendo 3 aguardando produção, 2 aguardando embarque, 2 aguardando chegada, 2 em desembaraço e 1 entregue. O décimo IP é o `Teste` (ELETRA CURITIBA), criado no HML às 16:29. O Preview `erp-comex-6fw8khy4r` ficou `Ready` no alias estável e já serve os rótulos novos. Produção, `main` e as variáveis da Vercel não foram alteradas.

## ICMS de importação por UF e simulador de tributos (M073) no HML (2026-10-28)

Os commits `1096cf5` (API, M073), `b061de8` (web) e `fbd0ef4` (vínculo das importadoras) publicam o simulador de tributos no detalhe da NCM (`GET /api/v1/ncm-rates/:code/estimate`) e o painel **ICMS de importação por UF** em `/catalog/ncm-rates` (`GET /api/v1/icms-rates`, `POST|PATCH /api/v1/icms-rates/rates`, `PATCH /api/v1/icms-rates/states/:uf`, `POST|PATCH /api/v1/icms-rates/benefits`, `PATCH /api/v1/icms-rates/importers/:importer`). A gestão usa a permissão nova `icms-rates.manage`, só Master e Administrador; o Fiscal recebe 403. A estimativa não grava nada.

Antes da migration, o HML estava em M001–M072. Backup custom pré-M073: `/var/backups/import-erp/erp_po_totvs_hml_m073_20261028T140243Z.dump`, 467.222.267 bytes, SHA-256 `28b5744466dd7a258658402f752a846a7ac30711b061cb9bff471c9c6f4db0ac`, validado com `pg_restore --list`. A M073 só cria tabelas; foi ensaiada com ROLLBACK e aplicada como `postgres` numa transação que recusa outro banco ou ledger diferente de 72, com checksum LF `1cb89d74e573de3ae06855fa225cfc6e9370e3ce60b4d7a4cefb5f149f235a5d`; ledger 73/73. Seeds, todos não revisados: PR 19,5%, CE 20% e AM 20%, e os vínculos ELETRA CWB → PR, ELETRA FOR → CE, ELETRA MATRIZ → CE e ELETRA MAO → AM. A conferência mostrou que o cadastro do HML grava `Eletra Cwb`, `ELETRA For` e `Eletra Matriz`; o `fbd0ef4` passou a comparar os nomes sem diferenciar maiúsculas e espaços e permite vincular uma importadora cadastrada ainda sem UF (versão `"0"`). Sem UF no HML: `ELETRA CURITIBA`, `ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L`, `ELETRA INDUSTRIA E COMERCIO( GALPAO-FORTALEZA )`, `ELETRA INDUSTRIA E COMERCIO (MANAUS)`, `ELETRA INDUSTRIA E COMERCIO (MANAUS) IMP 5` e `Livoltek Manaus`.

O release `/opt/import-erp/apps/api/hml-release-fbd0ef4` foi montado com `git -c core.autocrlf=false archive`, reaproveitando o `node_modules` de `hml-release-a00a050` (lockfile igual), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-fbd0ef4.conf`; o worker foi movido com `enable-homologation-export-worker.sh fbd0ef4`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-icms-fbd0ef4-predeploy`. Rollback somente do código: remova o drop-in `fbd0ef4`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-a00a050`) e rode `enable-homologation-export-worker.sh a00a050`; a M073 pode permanecer.

Após o restart, `/health/live` respondeu 200 e as rotas novas sem sessão responderam 401; com as versões de alíquotas já carregadas, a API só agendou a atualização das 07:00. As rotas do release, chamadas pelo próprio Fastify contra o HML com `default_transaction_read_only=on`, calcularam para 8504.40.90, VA R$ 10.000,00 e Taxa Siscomex R$ 154,23: II 2.000,00 (Anexo VI), IPI 1.170,00, PIS 210,00, COFINS 965,00; PR base 18.011,47, ICMS 3.512,24, total 7.857,24; CE e AM base 18.124,04, ICMS 3.624,81, total 7.969,81, iguais ao cálculo manual, com os avisos de ICMS não revisado, PIS/COFINS pela regra geral e exceções condicionais do II. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Alíquotas de II, IPI e PIS/COFINS por NCM (M072) no HML (2026-10-28)

Os commits `baa584c` (API, M072) e `a00a050` (web) publicam a tela **Alíquotas por NCM** (`/catalog/ncm-rates`) e as rotas `GET /api/v1/ncm-rates`, `GET /api/v1/ncm-rates/status`, `GET /api/v1/ncm-rates/:code`, `POST /api/v1/ncm-rates/refresh` e `POST|PATCH /api/v1/ncm-rates/pis-cofins-exceptions`. A gestão (atualização manual e exceções de PIS/COFINS) usa a permissão nova `tax-rates.manage` (Master, Administrador e Fiscal); a leitura usa `catalog.read`. O módulo é independente da sincronização de NCM: não importa `siscomex-ncm`, `mdic-ncm`, `ncm-sync`, `ncm-snapshot` nem `ttce`, e não escreve nas tabelas deles.

Antes da migration, o HML estava em M001–M071, com 10.516 NCMs oficiais e 230 NCMs na entidade. Backup custom pré-M072: `/var/backups/import-erp/erp_po_totvs_hml_m072_20261028T132618Z.dump`, 466.943.816 bytes, SHA-256 `ccb79549274d6daaa7ccf367876dcd02532628886c6178921edb08a5139e78fb`, validado com `pg_restore --list`. A M072 só cria tabelas novas; foi ensaiada no próprio HML numa transação com ROLLBACK e aplicada como `postgres` dentro do container, numa transação que recusa outro banco ou ledger diferente de 71, com checksum LF `75772b63dd1249f148bdeefe8517c737cb683b4f23e730e6ae4d53be15f2ba80`; ledger 72/72. O papel `import_erp_hml_app` insere nas tabelas novas e não apaga.

O release `/opt/import-erp/apps/api/hml-release-a00a050` foi montado com `git -c core.autocrlf=false archive`, reaproveitando o `node_modules` de `hml-release-fffc95a` (lockfile igual), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-a00a050.conf`; o worker foi movido com `enable-homologation-export-worker.sh a00a050`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-ncm-rates-a00a050-predeploy`. Rollback somente do código: remova o drop-in `a00a050`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-fffc95a`) e rode `enable-homologation-export-worker.sh fffc95a`; a M072 pode permanecer, pois o release anterior não lê as tabelas novas.

Após o restart, `/health/live` respondeu 200 e as rotas novas sem sessão responderam 401. Sem versão carregada, a API baixou as duas fontes ao iniciar (10:29:58–10:30:13): Gecex 272 (`Atualizado até Resolução Gecex nº 926`, página de 26/10/2026) com 10.516 NCMs e 3.090 exceções dos Anexos III–X, e TIPI com 11.102 linhas (a planilha da Receita ainda cita o ADE RFB nº 1/2026 como última atualização). A auditoria registrou 2 `IMPORT`. A próxima atualização automática ficou para 07:00 (`NCM_RATES_REFRESH_TIME`, padrão do HML). Conferência somente leitura: o snapshot e o estado da sincronização de NCM mantiveram os horários das 06:00/06:01, o total de NCMs oficiais e da entidade não mudou, e 221 das 230 NCMs cadastradas têm II na TEC vigente. As rotas do release, chamadas pelo próprio Fastify contra o HML com `default_transaction_read_only=on`, devolveram 10.516 NCMs vigentes; 0703.20.90 com II aplicado de 35% (LETEC, Anexo V) e IPI NT; 8504.40.90 com 20% (Anexo VI), o Ex 100 e a regra aeronáutica como condicionais. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Tipo de demanda (MTS / Não MTS) na PO (M071) no HML (2026-10-27)

Os commits `9962b1c` (API, M071), `bae8778` (web) e `fffc95a` (simulações) passam o tipo de demanda do produto para a PO. `procurement.purchase_order.demand_type` é o único lugar onde o tipo fica, e todo produto da PO o herda no follow-up, na carteira por produto, no End to End e nas exportações. As rotas de cabeçalho da PO (`POST /purchase-orders`, `POST /purchase-orders/complete`, `PATCH /purchase-orders/:id` e `PATCH /purchase-orders/:id/complete`) aceitam `demandType`; quando ele não é enviado, o valor salvo é mantido. As rotas de produto recusam `demandType` com `INVALID_FOLLOWUP`. A API anterior recusa `demandType` no cabeçalho e lê a coluna do produto, por isso a API foi publicada antes do web e junto com a M071.

Antes da migration, o HML estava em M001–M070, com 14 POs, 448 itens, 11.606 linhas de auditoria e 10.104 mensagens outbox. Backup custom pré-M071: `/var/backups/import-erp/erp_po_totvs_hml_m071_20261027T201628Z.dump`, 466.857.934 bytes, SHA-256 `e15db3969e2cb29cae606d8589c55059d03774d1f0c793249a409f989d897d8b`, validado com `pg_restore --list`. A M071 foi validada na cópia restaurada `erp_po_hml_m071_check_20261027T201628Z`: ledger 71, contagens inalteradas, coluna na PO, coluna do item removida, nenhuma PO tipada (a 030201 tinha MTS e Não MTS nos produtos) e texto vazio recusado. A cópia foi removida. A M071 foi aplicada somente no `erp_po_totvs_hml`, como `postgres` dentro do container, numa transação que recusa outro banco, com checksum LF `1bee81b9604f2d3d3601cdffffa3647b3292577cb7da858aaaee69aedc0f60c7`; ledger 71/71.

O release `/opt/import-erp/apps/api/hml-release-fffc95a` foi montado com `git -c core.autocrlf=false archive`, reaproveitando o `node_modules` de `hml-release-b56ee55` (lockfile igual), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-fffc95a.conf`. Os drop-ins anteriores (API e worker) estão em `/var/backups/import-erp/hml-po-demand-type-fffc95a-predeploy`. O rollback só do código não é possível depois da M071, porque o `b56ee55` lê `purchase_order_item.demand_type`; para voltar, restaure o backup acima. Após o restart, `/health/live` respondeu 200, e `/api/v1/purchase-orders` e `/api/v1/purchase-order-lines` sem sessão responderam 401. O worker foi movido com `enable-homologation-export-worker.sh fffc95a`. Produção (`import-erp-api` desde 2026-10-17 12:38:12, `import-erp-export-worker` desde 2026-10-19 20:38:54) e as variáveis da Vercel não foram alteradas. O Preview `erp-comex-m9b0wyrqa` ficou `Ready` no domínio estável e já serve os textos novos.

Simulações, rodadas a partir de uma pasta com `hml-simulation.mjs` e as duas seeds:
- `seed-hml-po-030201-demo.mjs demand-type` gravou MTS na PO 030201 pela rota de cabeçalho. Os IPs A–G não mudaram;
- `seed-hml-po-nmts-demo.mjs apply` criou pela API a PO `SIM-NMTS-01` (Não MTS), com os 59 produtos das linhas 0154–0212 da 030201, e os IPs `SIM-NMTS-01-A/2026` (aéreo, DESEMBARAÇO, ETA 2026-10-22) e `SIM-NMTS-01-B/2026` (marítimo, AGUARDANDO EMBARQUE, ETA 2026-12-27), com as datas dos IPs D e E da 030201. `revert` desfaz essa simulação e exclui a PO; depois disso o número não pode ser recriado, só restaurado.

Conferência somente leitura (`default_transaction_read_only`, `queryShipmentLines` do release): ledger 71, 15 POs e 507 itens. As 225 linhas da 030201 são MTS, com T3 de 30 dias, e as 59 linhas da `SIM-NMTS-01` são Não MTS, com T3 de 45 dias.

## Escolha de colunas nas exportações Excel no HML (2026-10-27)

Os commits `e21fa04` e `b56ee55` (API) e `06c5eac` (web) fazem cada exportação oferecer somente as colunas da tabela da sua tela (Carteira de POs, Carteira por produto e End to End), na ordem da tabela. As rotas `POST /api/v1/exports/purchase-orders` e `/purchase-order-lines` aceitam `context` e `columns` (`[{ key, header }]`, com cabeçalhos no idioma da interface). A rota de POs aceita também `lifecycle`. O worker resolve as colunas e falha com `INVALID_EXPORT_COLUMNS` quando elas são inválidas. Tarefas sem `columns` mantêm o layout anterior (8 e 92 colunas). O `b56ee55` corrige o `failJob` do worker: o tipo do parâmetro `$3` era ambíguo (42P08), e por isso qualquer tarefa com falha derrubava o worker. Não há migration. O web novo envia campos que a API anterior recusa com 400; por isso a API e o worker foram publicados antes do web. Decisões em `docs/PLANO_EXPORTACAO_COLUNAS.md`.

O release `/opt/import-erp/apps/api/hml-release-b56ee55` foi montado com `git -c core.autocrlf=false archive b56ee55:apps/api` (fontes conferidas sem CR), reaproveitando o `node_modules` de `hml-release-65c3681` (lockfile igual), compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-b56ee55.conf`. O worker foi movido com `enable-homologation-export-worker.sh b56ee55`, usando o script do próprio commit. Antes dele, o `hml-release-e21fa04` ficou ativo por poucos minutos, com o drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzzz-release-e21fa04.conf`, e expôs a falha do worker. Backup dos drop-ins e `ExecStart` anteriores da API e do worker: `/var/backups/import-erp/hml-export-columns-e21fa04-predeploy`. Rollback somente do código: remova os drop-ins `e21fa04` e `b56ee55` da API, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-65c3681`) e rode `enable-homologation-export-worker.sh 65c3681`.

Após a troca, API e worker HML ficaram ativos no release `b56ee55`. `/health/live` respondeu `200`, e `POST /api/v1/exports/purchase-order-lines` sem sessão respondeu `401`. `MIGRATION_ENV=isolated node --env-file=/etc/import-erp/homologation-db.env test/export-worker-hml.integration.mjs` passou, com `current_database() = 'erp_po_totvs_hml'` e o papel `import_erp_hml_app`. O teste gerou os dois layouts antigos (8 e 92 colunas), a carteira com `lifecycle=all` e as colunas `PO TOTVS`, `Status` e `Itens`, o End to End com `PO`, `Produto`, `Atraso acumulado até T3` e `Atraso`, e falhou a tarefa inválida com `INVALID_EXPORT_COLUMNS` sem derrubar o worker; as tarefas de teste foram apagadas ao final. Conferência somente leitura depois: nenhuma tarefa ficou em `running`. Produção (`import-erp-api` e `import-erp-export-worker`), `main` e as variáveis da Vercel não foram alteradas.

## Produto e modal filtram o End to End; gráficos seguem a tabela no HML (2026-10-27)

Os commits `3562aa4` (API) e `65c3681` (web) acrescentam os filtros `demandType=mts|notMts` e `modal=sea|air` a `GET /api/v1/purchase-order-lines`, à rota `e2e-stages`, à exportação e ao worker. Eles comparam o `demandType` e o `air` calculados da linha; linhas sem tipo de demanda ou sem modal só aparecem sem esses filtros. A rota `e2e-stages` passa a aceitar também `stage`, `view` e `late`:
- os gráficos (`overview`) seguem esses filtros e mostram as linhas da tabela;
- os cards das etapas (`stages`, `totalCount`, `delivered`) seguem o cenário e os filtros dos gráficos, mas não a etapa.

Não há migration. O web novo envia esses parâmetros ao resumo, e a API anterior os recusa com 400; por isso a API foi publicada antes do web.

O release `/opt/import-erp/apps/api/hml-release-65c3681` foi montado com `git -c core.autocrlf=false archive` (fontes conferidas sem CR), reaproveitando o `node_modules` de `hml-release-2ba6b5a`, compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzzz-release-65c3681.conf`; o worker foi movido com `enable-homologation-export-worker.sh 65c3681`. Backup: `/var/backups/import-erp/hml-e2e-scenario-65c3681-predeploy`. Rollback somente do código: remova o drop-in novo, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-2ba6b5a`) e rode `enable-homologation-export-worker.sh 2ba6b5a`.

Após a troca, `/health/live` respondeu `200` e `e2e-stages?modal=sea&stage=T4` sem sessão respondeu `401`. Conferência somente leitura (`import_erp_hml_app`, `default_transaction_read_only=on`, `erp_po_totvs_hml`), com as funções do release, sobre as 225 linhas com `situation=all`:
- **Cenário:** MTS 166 e Não MTS 59; marítimo 156 e aéreo 69. Em cada caso, os cards, os gráficos e a tabela tiveram o mesmo total.
- **Etapa:** com `stage=T3` (68), `stage=T4` (111), `stage=T3&view=reached` (157), `late=true` (68) e `stage=T4&late=true&modal=sea` (0), os gráficos tiveram as mesmas linhas da tabela, e os cards das etapas não mudaram.

Produção (`import-erp-api` desde 2026-10-17 12:38:12, `import-erp-export-worker` desde 2026-10-19 20:38:54), `main` e as variáveis da Vercel não foram alteradas. O Preview `erp-comex-fdf88irdb` do commit `65c3681` ficou `Ready` no alias estável da `homologacao`.

## Faixa de atraso total no End to End HML (2026-10-27)

Os commits `b3d2fdd` (API) e `2ba6b5a`/`489cfcf` (web) acrescentam a faixa do atraso total (regra "Faixa de atraso total" do Power BI: adiantado, no prazo, até 30, 30–45, 45–60, 60–90, 90–120, 120 dias ou mais e sem dados) ao resumo `e2e-stages` (`overview.byDelayRange`) e o filtro `delayRange` a `GET /api/v1/purchase-order-lines`, à rota `e2e-stages`, à exportação e ao worker. O resumo continua com filtro cruzado entre os três gráficos. Não há migration. O web novo envia `delayRange`, que a API anterior recusa com 400; por isso a API foi publicada antes do web.

O release `/opt/import-erp/apps/api/hml-release-2ba6b5a` foi montado com `git -c core.autocrlf=false archive` (fontes conferidas sem CR), reaproveitando o `node_modules` de `hml-release-c8a9c6c`, compilado na VPS e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzzz-release-2ba6b5a.conf`; o worker foi movido com `enable-homologation-export-worker.sh 2ba6b5a`. Backup dos drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-e2e-delay-range-2ba6b5a-predeploy`. Rollback somente do código: remova o drop-in novo da API, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-c8a9c6c`) e rode `enable-homologation-export-worker.sh c8a9c6c`.

Após a troca, `/health/live` respondeu `200` e `e2e-stages?delayRange=upTo30` sem sessão respondeu `401`. Conferência somente leitura (`import_erp_hml_app`, `default_transaction_read_only=on`, `erp_po_totvs_hml`) com as funções do release, sobre as 225 linhas com `situation=all`: até 30 dias `24668563` itens em 192 linhas, 30 a 45 dias `2671000` em 23 e 45 a 60 dias `1887900` em 10, somando 225; com `delayRange=upTo30`, as faixas ficaram iguais e a barra de status, o total e a tabela ficaram com as 192 linhas. Os números de status e prazo da seção abaixo não mudaram. Produção (`import-erp-api` desde 2026-10-17 12:38:12, `import-erp-export-worker` desde 2026-10-19 20:38:54), `main` e as variáveis da Vercel não foram alteradas.

## Resumo compacto e filtro cruzado no End to End HML (2026-10-27)

Os commits `3c65cce` (API) e `c8a9c6c` (web) acrescentam o filtro `deadline=onTime|onLimit|late|noData` a `GET /api/v1/purchase-order-lines`, à rota `e2e-stages`, à exportação e ao worker. O resumo passa a usar filtro cruzado: a barra de status ignora o filtro de status, a pizza de prazo ignora o filtro de prazo, e os cards das etapas e a tabela seguem os dois. Não há migration. O web novo envia `deadline`, que a API anterior recusa com 400; por isso a API foi publicada antes do web.

O release `/opt/import-erp/apps/api/hml-release-c8a9c6c` foi montado com `git -c core.autocrlf=false archive` (fontes conferidas sem CR), reaproveitando o `node_modules` de `hml-release-4362a3c`, compilado na VPS com o `tsc` desse `node_modules` e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzzz-release-c8a9c6c.conf`. O worker foi movido com `enable-homologation-export-worker.sh c8a9c6c`. Os drop-ins e `ExecStart` anteriores da API e do worker estão em `/var/backups/import-erp/hml-e2e-crossfilter-c8a9c6c-predeploy`. Rollback somente do código: remova o drop-in novo da API, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-4362a3c`) e rode `enable-homologation-export-worker.sh 4362a3c`.

Após a troca, API e worker HML ficaram ativos no release `c8a9c6c`; `/health/live` respondeu `200` e `e2e-stages?deadline=late` sem sessão respondeu `401`. Conferência somente leitura com `import_erp_hml_app`, `default_transaction_read_only=on` e `current_database() = 'erp_po_totvs_hml'`, usando as funções do release: sem filtros, 225 linhas (22 entregues), com as 6 categorias de status e as 4 de prazo somando 225; com `deadline=late`, a pizza ficou igual e a barra somou as 225 atrasadas; com `status=AGUARDANDO CHEGADA`, a barra manteve as 6 categorias e a pizza ficou com as 111 linhas desse status (`14025245` itens); a tabela com `deadline=late` trouxe 225 linhas. Produção (`import-erp-api` desde 2026-10-17 12:38:12, `import-erp-export-worker` desde 2026-10-19 20:38:54), `main` e as variáveis da Vercel não foram alteradas. O Preview `erp-comex-700fh5j8o` do commit `c8a9c6c` ficou `Ready` no alias estável da `homologacao`, e o CSS publicado já contém as regras novas.

## Gráficos de quantidade por status e prazo no End to End HML (2026-10-27)

Os commits `b938588` (API) e `4362a3c` (web) acrescentam ao resumo End to End as quantidades exatas por status da linha e por situação do prazo, e exibem os dois gráficos SVG no topo de `/end-to-end`. A mudança é aditiva, não inclui migration e não altera os filtros, a exportação ou as contagens existentes.

O release `/opt/import-erp/apps/api/hml-release-4362a3c` foi montado com `git -c core.autocrlf=false archive`, reaproveitando o `node_modules` de `hml-release-4bceceb`, e ativado pelo drop-in `zzzzzzzzzzzzzzzzzzzzzzzz-release-4362a3c.conf`. Os drop-ins e `ExecStart` anteriores da API e do worker estão em `/var/backups/import-erp/hml-e2e-overview-4362a3c-predeploy`. Rollback somente do código: remova o drop-in novo da API, restaure o diretório de drop-ins do worker a partir desse backup, execute `systemctl daemon-reload` e reinicie `import-erp-hml-api` e `import-erp-hml-export-worker`; a API volta a `hml-release-4bceceb`. Não há migration para reverter.

Após a troca, API e worker HML ficaram ativos no release `4362a3c`; `/health/live` respondeu `200` e `GET /api/v1/purchase-order-lines/e2e-stages` sem sessão respondeu `401`. A conferência somente leitura usou a role `import_erp_hml_app` e confirmou `current_database() = 'erp_po_totvs_hml'`: 225 linhas, 22 entregues, soma das linhas de cada agrupamento igual a 225, `byStatus.ENTREGUE.lines = 22` e soma das quantidades igual a `29.227.463` nos dois agrupamentos. Na fotografia de 2026-10-27, as 225 linhas tinham atraso total positivo.

O Preview do commit `4362a3c` ficou `Ready` no deployment `dpl_Hf26dWD2MHF2Hpitqjs1WKoJdcUF`, com o alias estável da branch `homologacao`. `/login` respondeu com a página do TMS e os três idiomas. A validação visual autenticada dos gráficos ficou pendente porque não havia sessão válida da aplicação neste ambiente; nenhuma senha foi alterada e nenhuma conta foi exposta ou bloqueada. Produção, `main` e variáveis da Vercel não foram alteradas.

## Etapas animadas do End to End com filtro por etapa no HML (2026-10-26)

Os commits `113ec9f` (API) e `4bceceb` (web) colocam a trilha animada T0–T5 sobre a tabela de `/end-to-end`. A API
passa a devolver, por linha, `e2e.currentStage` (etapa seguinte à última com data real; nulo para entregue ou
cancelado), `e2e.currentStageLate` (hoje depois do prazo dessa etapa) e `accumulatedDelayDays` em cada etapa.
`GET /api/v1/purchase-order-lines` e a exportação aceitam `stage=T0..T5`, `view=current|reached` e `late=true`; com
esses filtros a API calcula todas as linhas filtradas antes de paginar. `GET /api/v1/purchase-order-lines/e2e-stages`
conta, por etapa, as linhas na etapa e as que já a concluíram, com as atrasadas. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-4bceceb` foi montado com `git -c core.autocrlf=false archive`,
reaproveitando o `node_modules` de `hml-release-838db2b`, e ativado pelo drop-in
`zzzzzzzzzzzzzzzzzzzzzzz-release-4bceceb.conf`; os drop-ins anteriores (API e worker) estão em
`/var/backups/import-erp/hml-e2e-stages-4bceceb-predeploy`. Rollback somente do código: remova o drop-in novo, execute
`systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-838db2b`) e rode
`enable-homologation-export-worker.sh 838db2b`. Após o restart, `/health/live` respondeu 200 e as rotas novas sem sessão
responderam 401; o worker HML foi movido com `enable-homologation-export-worker.sh 4bceceb`. Produção
(`import-erp-api` desde 2026-10-17 12:38:12, `import-erp-export-worker` desde 2026-10-19 20:38:54) e as variáveis da
Vercel não foram alteradas. O Preview `erp-comex-c1b6vzt3e` do commit `4bceceb` ficou `Ready` no domínio estável.

Conferência somente leitura (sessão `default_transaction_read_only`, funções do release) no `erp_po_totvs_hml`: 203
linhas em aberto (225 com entregues; 22 entregues); na etapa T3 68 (todas atrasadas), T4 111 e T5 24; concluíram T3
135 em aberto, todas com atraso em T3. A contagem de cada etapa coincide com o total do filtro correspondente. A
consulta completa levou cerca de 100 ms com esse volume. As linhas do IP B da PO 030201 têm atraso acumulado +7 até T3.

## Metas E2E por data de necessidade (M070) e tela End to End no HML (2026-10-26)

Os commits `09ea414` (API) e `838db2b` (web) passam o End to End para as regras da planilha original: um único
cálculo na API (`calculateFollowup` → `e2e`) alimenta a tela `/end-to-end` (uma linha por produto e IP com T0–T5,
totais, gargalo e mês de chegada), a exportação Excel, a análise por PO (`/end-to-end/po?id=`) e o painel de Follow
Up. As metas ficam em `catalog.e2e_target_set` (M070), editáveis somente por Master/Administrador em
`/end-to-end/targets`, com motivo, auditoria e outbox. As colunas `target_*_days` do item deixaram de ser usadas.

Antes da migration, o HML estava em M001–M069. Backup custom pré-M070:
`/var/backups/import-erp/erp_po_totvs_hml_m070_20261026T200210Z.dump`, 466.764.361 bytes, SHA-256
`b1fd09962174820fb15ae05eacaa8e6ec57eed8b2f7f5a17fd23538f1b562e65`, 432 entradas no `pg_restore --list`. A M070 foi
validada na cópia restaurada `erp_po_totvs_hml_m070check` (ledger 70, conjunto inicial 8/8/7/30/45/55/10/10 e grants
para `import_erp_app` e `import_erp_hml_app`), que foi removida. A M070 foi aplicada somente no `erp_po_totvs_hml`,
numa transação que recusa outro banco, com checksum LF
`4a3bdce09a019db79276f732be72d1eb5ce03c862bd234aed6a4894fffd2b0f4`; ledger 70/70.

O release `/opt/import-erp/apps/api/hml-release-838db2b` foi montado com `git -c core.autocrlf=false archive`,
reaproveitando o `node_modules` de `hml-release-1a4592a`, e ativado pelo drop-in
`zzzzzzzzzzzzzzzzzzzzzz-release-838db2b.conf`; os drop-ins anteriores estão em
`/var/backups/import-erp/hml-e2e-838db2b-predeploy`. Para rollback somente do código, remova o drop-in novo, execute
`systemctl daemon-reload` e reinicie `import-erp-hml-api` (volta a `hml-release-1a4592a`, que não lê a M070). Após o
restart, `/health/live` respondeu 200 e `/api/v1/e2e-targets`, `/api/v1/purchase-order-lines` e
`/api/v1/purchase-orders` sem sessão responderam 401. O worker HML foi movido com
`enable-homologation-export-worker.sh 838db2b`; o worker de produção manteve o `ActiveEnterTimestamp` de
2026-10-19 20:38:54 de Brasília. O Preview `erp-comex-ezsu5l3ax` do commit `838db2b` ficou `Ready` no domínio estável.

Conferência somente leitura (sessão `default_transaction_read_only`, `queryShipmentLines` do release) da PO 030201:
225 linhas nos IPs A–G; as 57 linhas de resistores do IP B têm T0 −6, T1 +10, T2 −4, T3 +7, T4 −2 e T5 0 (T4 e T5
por previsão), total 118/123/+5, gargalo T1, chegada 2026-11. Produção (`erp_po_totvs_test`, `api.env`,
`import-erp-api`, `import-erp-export-worker`) e as variáveis da Vercel não foram alterados.

## Tipo de demanda (M069), análise E2E e simulação da PO 030201 no HML (2026-10-26)

O commit `738c954` cria a lista `DEMAND_TYPE` (MTS / Não MTS) e o campo `demand_type` do item da PO, separado da
origem da demanda (`DEMAND`), e corrige os prazos do modelo E2E: MTS 30 dias e Não MTS 45 dias na HQ. O commit
`1a4592a` transforma `/end-to-end?po=<id>` numa análise da PO (planejado pelo modelo × datas reais e previstas por IP).

Antes da migration, o HML `erp_po_totvs_hml` estava em M001–M068, com 12 IPs, 10.475 linhas de auditoria, 8.971
mensagens outbox, 310 valores operacionais e 448 itens de PO. O backup custom pré-M069 foi validado com
`pg_restore --list` (416 entradas): `/var/backups/import-erp/erp_po_totvs_hml_m069_20261026T180942Z.dump`,
466.563.175 bytes, SHA-256 `bf4b120a04f580f5adc3a4722c5ef5391c02461bf58386790e13526787ede2aa`. A M069 foi aplicada
na cópia restaurada `erp_po_hml_m069_check_20261026T181211Z`: ledger M069, 2 valores `DEMAND_TYPE`, os 40 valores
`DEMAND` e os 448 itens preservados e entidade desconhecida rejeitada; a cópia foi removida. A M069 foi aplicada
somente no HML, como `postgres` dentro do container, com checksum
`dfb58f9bfe5142e31981863ac69d58e97a05045f316dcef0a33253d738c8a05f`; ledger 69/69, contagens inalteradas e +2 valores
operacionais.

O release foi montado na VPS como `/opt/import-erp/apps/api/hml-release-1a4592a` com
`git -c core.autocrlf=false archive` (no Windows, sem essa opção as fontes chegam em CRLF e o checksum da migration
diverge), reaproveitando o `node_modules` de `hml-release-443b927` (dependências inalteradas), e ativado pelo drop-in
`zzzzzzzzzzzzzzzzzzzzz-release-1a4592a.conf`. O drop-in e o `ExecStart` anteriores estão em
`/var/backups/import-erp/hml-e2e-1a4592a-predeploy`. Para rollback somente do código, remova o drop-in novo, execute
`systemctl daemon-reload` e reinicie `import-erp-hml-api` (volta a `hml-release-443b927`); a M069 deve permanecer.
A API HML escuta em `172.18.0.1:4001`: `/health/live` respondeu 200 e `GET /api/v1/purchase-orders/:id/followup` sem
sessão respondeu 401. O worker `import-erp-hml-export-worker` foi movido para o mesmo release com
`enable-homologation-export-worker.sh 1a4592a`; o worker de produção manteve o `ActiveEnterTimestamp`. O Preview
`erp-comex-8r3pcsap8` do commit `1a4592a` ficou `Ready` no domínio estável.

A pedido do usuário, `seed-hml-po-030201-demo.mjs` reverteu os IPs `DEMO-030201-IP01`…`IP07` da primeira simulação
(215 alocações e 4 invoices cancelados pela API) e montou uma simulação realista da PO 030201 ativa (importador
ELETRA INDUSTRIA…, fornecedor EX000135), run `290556F4F1C1`, com as datas reais do Follow Up: necessidade 01/12/2026,
plano comercial 03/08, SC 020028 aprovada em 21/08 (sincronizada pela API), PO enviada em 24/08, solicitante
"PCM - JOSIVAN" e finalidade "Estoque Insumos (Componente)". Cada linha recebeu o tipo de demanda pela família do
produto, e as 215 linhas foram distribuídas em sete IPs `030201-A/2026`…`G/2026` (225 alocações; G recebe 30% das
cinco maiores linhas de B e de C):

| IP | Linhas | Tipo | Modal | Status em 26/10 | Folga contra 01/12 |
|---|---|---|---|---|---|
| A | 22 (CIs e dispositivos) | MTS | Aéreo | ENTREGUE (14/10) | +48 |
| B | 58 (resistores) | MTS | Marítimo | AGUARDANDO CHEGADA | -1 |
| C | 53 (capacitores, bobinas, LEDs) | MTS | Marítimo | AGUARDANDO CHEGADA (ETA 02/12, como no Follow Up) | -11 |
| D | 24 (eletrônicos sob encomenda) | Não MTS | Aéreo | DESEMBARAÇO | +30 |
| E | 35 (mecânicos e cobre) | Não MTS | Marítimo | AGUARDANDO EMBARQUE | -36 |
| F | 23 (diodos) | MTS | Aéreo | AGUARDANDO PRODUÇÃO | +5 |
| G | 10 (saldo parcial) | MTS | Marítimo | AGUARDANDO PRODUÇÃO | -52 |

A análise E2E sobre a resposta real da rota de followup da API HML encontrou 69 de 225 linhas no prazo, maior atraso
no IP G e a etapa T3 (produção HQ até o embarque) com o maior desvio médio (+22,7 dias). A data da PO (`order_date`,
21/10) não foi alterada: a API não permite editá-la e a simulação não grava fora dela. A PO excluída de mesmo número
(Eletra Cwb) não foi alterada. O script fica também em `/root/hml-demo/`. Execute-o com
`MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env seed-hml-po-030201-demo.mjs apply|revert`.
Use `--env-file`: `source` do arquivo no shell não exporta `DATABASE_URL`. `revert` cancela as alocações e invoices
da simulação e exclui os IPs pela API (os campos de pré-embarque e o tipo de demanda das linhas permanecem); `apply`
recusa rodar enquanto existirem IPs da simulação ou alocações ativas na PO.

## Rate limit por cliente real no HML (2026-10-26)

Os commits `443b927` e `9febc70` fazem a Vercel encaminhar o IP validado do
cliente em um cabeçalho próprio e fazem a API confiar nele somente quando o
gateway token também é válido. O limite global passou de uma cota coletiva de
120/min para 300/min por IP; o login permanece em 10/min por IP. Não houve
migration nem escrita de dados.

A API foi compilada na VPS como
`/opt/import-erp/apps/api/hml-release-443b927`, reaproveitando o `node_modules`
do release anterior `hml-release-64ecb66`, e ativada pelo drop-in
`zzzzzzzzzzzzzzzzzzzz-release-443b927.conf`. O drop-in e o `ExecStart`
anteriores estão em
`/var/backups/import-erp/hml-rate-limit-443b927-predeploy`. Para rollback,
remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`; o serviço volta ao release anterior.

O serviço ficou `active`, `/health/live` respondeu 200 e o runtime foi
confirmado no banco `erp_po_totvs_hml`. Em testes sem sessão e sem consulta de
credenciais, uma chave sintética atingiu 429 após 300 respostas e outra
continuou em 200; no login, uma chave atingiu 429 após 10 respostas e outra
continuou em 403. Um diagnóstico temporário, removido após a verificação,
registrou apenas `kind: client` para uma chamada feita pelo Preview, confirmando
que o cabeçalho atravessou Vercel e os dois Traefiks sem registrar o IP.

O push da branch `homologacao` no commit `9febc70` gerou o Preview
`dpl_JCzSL1yGsikwGgHi696p1Rcedsba`, com status `Ready` e alias
`erp-comex-git-homologacao-eletra-comex.vercel.app`. A validação manual com
dois navegadores em redes físicas distintas continua pendente; nenhuma senha
real foi usada ou alterada.

## Candidatos da invoice em lote no HML (2026-10-26)

Os commits `353baf7` e `64ecb66` adicionam
`POST /api/v1/purchase-orders/invoice-candidates/batch`, preservam a rota GET
anterior e fazem a tela carregar todas as POs da invoice em uma chamada. Erros
do limite global agora mantêm HTTP 429, `Retry-After` e o problem
`RATE_LIMITED`. Não houve migration nem escrita de dados.

A API foi compilada na VPS como
`/opt/import-erp/apps/api/hml-release-64ecb66`, reaproveitando o `node_modules`
do release anterior `hml-release-413fe6a`, e ativada pelo drop-in
`zzzzzzzzzzzzzzzzzzz-release-64ecb66.conf`. O drop-in e o `ExecStart`
anteriores estão em
`/var/backups/import-erp/hml-invoice-batch-64ecb66-predeploy`. Para rollback,
remova o drop-in novo, execute `systemctl daemon-reload` e reinicie
`import-erp-hml-api`; o serviço volta ao release anterior.

O serviço ficou `active` e `/health/live` respondeu 200. A validação somente
leitura executou o código do release com `import_erp_hml_app` em
`erp_po_totvs_hml`: a PO 030201 respondeu 200 com 215 itens ativos, exatamente
duas consultas de dados e nenhum `sourcePoNumber` interno nos itens. Nenhum
banco ou serviço de produção foi consultado ou alterado.

O push da branch `homologacao` no commit `570d0eb` gerou o Preview
`dpl_DF5jNCKnXR6N1k4YfBKKauTP3bM5`, com status `Ready`, branch
`homologacao`, commit `570d0eb` e alias
`erp-comex-git-homologacao-eletra-comex.vercel.app`. A rota `/login` no alias
estável respondeu com a página do TMS - Supply Chain. O arquivo IPH034A citado
no plano não estava disponível no workspace para o upload autenticado; a
IPH034B disponível foi apenas analisada localmente (91 linhas, 97 destinos,
6 POs e nenhum erro de parsing) e não foi tratada como substituta do aceite da
IPH034A.

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
Daqui em diante, normalize as fontes para LF (`sed -i 's/
$//'`) antes do build.

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

## Painel de Pré Embarque no HML (2026-11-05)

O commit `9055133` (API, corrigido em `57ab97d`) cria `GET /api/v1/reports/pre-shipment/summary`, `/lines` e `/filter-options` (`src/pre-shipment-dashboard.ts`), com as métricas do BI de Pré Embarque: produtos e quantidade exata por status, aging desde o PO Sent Date (até 45, 45–60, 60–90, 90–120 e acima de 120 dias), a tabela de POs e os valores dos filtros. PO cancelada e saldo de item cancelado no TOTVS contam como CANCELADO. O resumo e a tabela passam pela mesma fila do End to End, criada uma vez em `server.ts`. O commit `a49e53a` (web) mostra o painel em `/reports/pre`. Regras em `docs/PLANO_DASHBOARD_PRE_EMBARQUE.md`. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-a49e53a` foi montado com `git -c core.autocrlf=false archive a49e53a:apps/api` (SHA-256 `caa2341d…cafd8`, nenhuma fonte com CR). Ele reaproveita o `node_modules` de `hml-release-c689986`: lockfile igual e `package.json` diferente só no script de teste. Foi compilado na VPS e ativado pelo drop-in de 61 `z` `…-release-a49e53a.conf`; o worker foi movido com `enable-homologation-export-worker.sh a49e53a`. Drop-ins e `ExecStart` anteriores: `/var/backups/import-erp/hml-pre-dashboard-a49e53a-predeploy`. Rollback somente do código: remova o drop-in `a49e53a`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-c689986`) e rode `enable-homologation-export-worker.sh c689986`. Sem a API nova, a tela de Pré Embarque mostra erro ao carregar o painel; as métricas da carga continuam.

No release passaram `test/pre-shipment-dashboard.test.mjs` (9 testes; os 2 de contrato com a web rodaram no repositório), `test/shipment-lines.test.mjs` (20) e `test/work-gate.test.mjs` (5). O ensaio só leitura no HML, com o código do release, contou 7.134 produtos (6.018 alocações ativas + 1.116 saldos, igual à contagem independente): A distribuir 864, Ag. produção 14, Ag. embarque 264, Ag. chegada 831, Desembaraço 327, Entregue 4.582 e Cancelado 252. Aging: 286, 171, 91, 87 e 128; 379 produtos sem PO Sent Date ficaram fora. A contagem da tabela bateu com o resumo para cada status e faixa. Resumo em 343 ms, página da tabela em 301 ms, rajada de 8 cliques (16 chamadas pela fila de 2) em 5,2 s, RSS de 90 MB. `/health/live` respondeu 200, a rota nova sem sessão respondeu 401, e API e worker ficaram ativos no `a49e53a`. Scripts e log em `/root/claude-release-a49e53a` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Exportação Excel do Pré Embarque no HML (2026-11-05)

Os commits `a1a2977` (API) e `550f049` (web) acrescentam a exportação da tabela do painel de Pré Embarque no modelo das outras: `POST /api/v1/exports/pre-shipment` grava o tipo `pre-shipment-xlsx` em `jobs.export_job` com os filtros e as seleções dos gráficos, e o worker escreve as linhas de `queryPreShipmentLines` na aba `Pré Embarque` (`pre-embarque.xlsx`), com as colunas escolhidas entre as 17 da tabela. Regras em `docs/PLANO_EXPORTACAO_COLUNAS.md`, seção 9. Não há migration.

O release `/opt/import-erp/apps/api/hml-release-191a2a2` foi montado com `git -c core.autocrlf=false archive 191a2a2:apps/api` (SHA-256 `f204e5e9…1338`, nenhuma fonte com CR), reaproveita o `node_modules` de `hml-release-a49e53a` (lockfile igual) e foi ativado pelo drop-in de 62 `z` `…-release-191a2a2.conf`; o worker foi movido com `enable-homologation-export-worker.sh 191a2a2`. Drop-ins anteriores: `/var/backups/import-erp/hml-pre-export-191a2a2-predeploy`. Rollback somente do código: remova o drop-in `191a2a2`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-a49e53a`) e rode `enable-homologation-export-worker.sh a49e53a`.

A primeira execução parou nos testes, antes de ativar: `test/export-columns.test.mjs` importa o catálogo da web no topo e não roda num release. Ele rodou completo no repositório; no release passaram `test/export-jobs.test.mjs` (8) e `test/pre-shipment-dashboard.test.mjs` (9). O ensaio só leitura no HML gerou e releu o arquivo com o código do release: 7.134 linhas (o total do painel), 17 colunas, 489 KB em 2,5 s; com a faixa de aging acima de 120 dias e só ETA, 128 linhas (a mesma contagem do gráfico) com PO e código do produto incluídos. `/health/live` respondeu 200, a rota de exportação sem sessão respondeu 401, e API e worker ficaram ativos no `191a2a2`. Scripts e logs em `/root/claude-release-191a2a2` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Aba Resumo na exportação do Pré Embarque no HML (2026-11-05)

O commit `f58c4c1` (API) acrescenta à exportação do Pré Embarque a aba `Resumo`, antes das linhas: uma tabela dinâmica das linhas exportadas com a data de referência, os filtros, produtos e quantidade por status, o aging por faixa e a matriz de aging por status (`docs/PLANO_EXPORTACAO_COLUNAS.md`, seção 9). Não há migration nem mudança na web.

O release `/opt/import-erp/apps/api/hml-release-f58c4c1` (SHA-256 `cf00fff6…`, nenhuma fonte com CR) reaproveita o `node_modules` de `hml-release-191a2a2` e foi ativado pelo drop-in de 63 `z` `…-release-f58c4c1.conf`; o worker foi movido com `enable-homologation-export-worker.sh f58c4c1`. Drop-ins anteriores: `/var/backups/import-erp/hml-pre-summary-f58c4c1-predeploy`. Rollback somente do código: remova o drop-in `f58c4c1`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-191a2a2`) e rode `enable-homologation-export-worker.sh 191a2a2`.

No release passaram `test/export-jobs.test.mjs` (8) e `test/pre-shipment-dashboard.test.mjs` (12). O ensaio só leitura no HML gerou e releu o arquivo com as 7.134 linhas (491 KB, 2,8 s); o Resumo bateu com o resumo do painel (calculado em SQL) em todos os status, faixas e na linha sem PO Sent Date, e a matriz somou os 1.142 produtos em espera. Com Entregue e Direct, 4.148 linhas, e o Resumo trouxe os dois filtros. `/health/live` respondeu 200, a rota de exportação sem sessão respondeu 401, e API e worker ficaram ativos no `f58c4c1`. Scripts e log em `/root/claude-release-f58c4c1` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.

## Cores das etapas na exportação do End to End no HML (2026-11-05)

O commit `31b685b` (API) pinta as colunas T0–T5 da exportação do End to End com as cores dos grupos de etapa da tela (`f3eeee8`, web): cabeçalho na cor da etapa com linha inferior, valores no tom claro (`docs/PLANO_EXPORTACAO_COLUNAS.md`, seção 10). Não há migration.

O release `/opt/import-erp/apps/api/hml-release-31b685b` (SHA-256 `7baa050f…`, nenhuma fonte com CR) reaproveita o `node_modules` de `hml-release-f58c4c1` (lockfile igual) e foi ativado pelo drop-in de 64 `z` `…-release-31b685b.conf`; o worker foi movido com `enable-homologation-export-worker.sh 31b685b`. Drop-ins anteriores: `/var/backups/import-erp/hml-pre-stage-colors-31b685b-predeploy`. Rollback somente do código: remova o drop-in `31b685b`, execute `systemctl daemon-reload`, reinicie `import-erp-hml-api` (volta a `hml-release-f58c4c1`) e rode `enable-homologation-export-worker.sh f58c4c1`.

No release passaram `test/purchase-order-export.test.mjs` (5) e `test/export-jobs.test.mjs` (8); `test/export-columns.test.mjs`, que lê o catálogo e os tokens da web, rodou no repositório. O ensaio só leitura no HML gerou e releu o arquivo com o código do release: todas as linhas, 2.300 linhas e 47 colunas (397 KB, 4,0 s); T3 acumulada, 1.158 linhas e 48 colunas (214 KB, 2,0 s). Nos dois, as 30 colunas de etapa saíram com cabeçalho, linha e valores na cor da etapa até a última linha, e as demais sem preenchimento. RSS de 363 MB. `/health/live` respondeu 200, a rota de exportação sem sessão respondeu 401, e API e worker ficaram ativos no `31b685b`. Scripts e log em `/root/claude-release-31b685b` na VPS. Produção, `main` e as variáveis da Vercel não foram alteradas.
