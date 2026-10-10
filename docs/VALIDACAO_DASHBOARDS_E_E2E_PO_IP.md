# Validação dos dashboards e do fluxo PO → IP

Atualizado em 2026-10-10. Este registro reúne o contrato dos indicadores, o mapeamento funcional e as evidências de teste do fluxo. O mapa de entidades e campos segue detalhado em [MAPA_COMPLETO_SC_PO_IP.md](MAPA_COMPLETO_SC_PO_IP.md) e [MAPEAMENTO_SALVAMENTO_PO_IP.md](MAPEAMENTO_SALVAMENTO_PO_IP.md).

## Fontes dos painéis

| Tela | Código web | Endpoint | Dados apresentados |
| --- | --- | --- | --- |
| Carteira de POs | `apps/web/app/page.tsx` | `GET /api/v1/purchase-orders/summary` | POs no recorte, IPs vinculados, itens, itens com/sem IP e POs por importador. Os filtros da carteira também delimitam o resumo. |
| Pré-embarque | `apps/web/app/reports/pre/page.tsx`, `apps/web/components/ReportsView.tsx` | `GET /api/v1/reports/summary?scope=pre` | POs totais, históricas, novas, itens operacionais, itens com vínculo ativo a IP, itens sem vínculo ativo e status das POs. |
| Pós-embarque | `apps/web/app/reports/post/page.tsx`, `apps/web/components/ReportsView.tsx` | `GET /api/v1/reports/summary?scope=post` | IPs totais, históricos, novos, abertos, com chegada, Duimp, entrega, custos adicionais e status logístico. |

As consultas ficam em `apps/api/src/purchase-orders.ts` e `apps/api/src/source-audit.ts`. A API aplica os importadores autorizados antes de agregar os resultados. O escopo `pre` retorna somente `preShipment`, o escopo `post` retorna somente `postShipment`; um escopo inválido responde HTTP 400.

### Regras de contagem

- **POs e IPs:** cada cabeçalho de PO e cada registro de IP é contado uma vez dentro do escopo autorizado.
- **Itens operacionais:** linhas de `procurement.purchase_order_item` ligadas às POs do escopo.
- **Itens vinculados:** item com alocação ativa em `procurement.po_item_allocation` ou observação histórica com IP válido que corresponda a um IP do mesmo importador.
- **Itens sem vínculo ativo:** itens não cancelados sem alocação ativa nem correspondência histórica válida de IP.
- **Chegada, Duimp, entrega e custos:** cada indicador de pós-embarque conta IPs que têm o campo correspondente preenchido; custos adicionais consideram multa, armazenagem ou demurrage acima de zero.
- **Status:** os agrupamentos são calculados sobre as POs ou os IPs já limitados ao conjunto de importadores autorizado. Registros sem status recebem o rótulo `Sem status`.

## Regras do fluxo SC → PO → IP

- A SC é criada antes da PO. O vínculo entre a SC e a PO é feito selecionando a SC no campo correspondente; seus dados compartilhados devem aparecer na PO. A documentação funcional existente registra quais campos são copiados e quais permanecem independentes.
- A PO guarda cabeçalho e itens. O saldo é calculado por item: quantidade pedida menos a soma das alocações ativas.
- Uma alocação associa o item da PO ao IP e registra a quantidade destinada. A soma alocada não pode exceder a quantidade pedida. A PO pode ser dividida entre vários IPs e um IP pode receber itens de várias POs.
- Datas e acompanhamento logístico pertencem a cada IP/alocação. ETD, ETA, chegada e entrega de um IP não devem sobrescrever os dados dos outros IPs associados à mesma PO.
- Encerramento e reabertura do IP são estados de ciclo separados do status logístico; não alteram a quantidade já alocada.

## Testes disponíveis e reprodução

### Integração dos relatórios com PostgreSQL

`apps/api/test/reports-summary.integration.mjs` inicia as rotas reais da API contra PostgreSQL. O teste compara todos os campos dos dois painéis e todos os grupos de status com consultas SQL diretas às tabelas, verifica os escopos `pre`/`post` e confirma a rejeição de um escopo inválido. Não insere nem altera registros.

Para reproduzir localmente, compile a API e aponte o teste a uma base descartável local cujo nome termine em `_ci` ou `_test`:

```powershell
Set-Location apps/api
..\..\node_modules\.bin\tsc.cmd -p tsconfig.json
$env:MIGRATION_ENV = 'isolated'
$env:DATABASE_URL = 'postgresql://usuario:senha@127.0.0.1:5432/erp_dashboard_test'
node test/reports-summary.integration.mjs
```

O teste recusa hosts que não sejam `localhost`, `127.0.0.1` ou `::1`, bancos sem sufixo `_ci`/`_test` e ambientes sem `MIGRATION_ENV=isolated`. Não use a URL da base operacional.

### Demais verificações

- API, executada a partir de `apps/api`: `authorization.test.mjs`, `data-issues.test.mjs`, `requests.test.mjs`, `requests.history.test.mjs`, `catalog.history.test.mjs`, `admin-outbox.test.mjs`, `operations.test.mjs`, `purchase-requests.test.mjs`, `followup-calculations.test.mjs`, `reports-scope.test.mjs` e `web-route-contract.test.mjs`.
- Testes web: `node --experimental-strip-types --test test/*.test.mjs` em `apps/web`.
- Integrações de PO, acompanhamento e fluxo HTTP: `purchase-orders.summary.integration.mjs`, `followup.integration.mjs`, `operations.integration.mjs` e `gateway-flow.integration.mjs`. Esses testes devem usar uma base descartável; o gateway E2E também precisa de Next.js e API ativos apontados para essa base.

## Evidências da execução em 2026-10-10

- A compilação TypeScript da API passou.
- API: **43 testes passaram**. Web: **11 testes passaram**.
- A integração de `reports-summary.integration.mjs` passou contra uma cópia descartável restaurada do PostgreSQL de produção. O ledger da cópia era M031. A comparação direta cobriu todos os indicadores e status de pré e pós-embarque, além dos dois escopos individuais.
- O fluxo HTTP E2E executado anteriormente na mesma sessão passou em cópia descartável: criou SC/PO/itens, distribuiu quantidades entre dois IPs, confirmou saldo zero, datas independentes por IP e encerramento/reabertura, com leitura direta das linhas gravadas.
- Ao final, o clone do relatório e os arquivos temporários foram removidos. A base operacional continuou no ledger de 31 migrações; não restou banco de teste com o prefixo usado pela execução.
- A inspeção visual com Playwright não foi concluída neste ambiente Windows: a chamada pelo Bash retornou `E_ACCESSDENIED`, e o comando PowerShell do `npx` foi bloqueado pela política de execução. Portanto, os dados API→PostgreSQL foram testados, mas não há evidência de screenshot/aceite visual do navegador nesta rodada.

## Limites desta validação

O teste de relatórios verifica o contrato do endpoint com registros reais da cópia restaurada e os compara com SQL independente; ele não cria fixtures novas para forçar cada categoria de status/data/custo. O build e os testes unitários da web passaram, mas não houve montagem e inspeção visual do componente por navegador nesta execução. O resultado não autoriza escrita na base operacional nem substitui o aceite visual de usuário.
