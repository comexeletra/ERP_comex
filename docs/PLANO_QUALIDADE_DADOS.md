# Tarefa: Qualidade dos dados clara e abrangente

## Objetivo

A tela `/quality` mostra códigos crus (`PRICE_WITHOUT_CURRENCY`, `OPEN`) e esconde a evidência em JSON, e só conhece os
erros gravados pela carga da planilha. Ela passa a explicar cada erro, mostrar os dados no cartão, resumir e filtrar por
tipo, e verificar também os dados atuais do sistema (POs, itens, IPs e SCs), calculados a cada leitura.

## Situação medida no HML (2026-11-03)

Pendências da carga (`migration.data_issue`), todas `OPEN` e `WARNING`, 174 no total:

| Código | Qtd. | Evidência |
|---|---|---|
| `MISSING_PO` | 86 | `importer`, `draftPo`, `productCode`, `ipNumber` |
| `PRICE_WITHOUT_CURRENCY` | 78 | `purchaseOrder`, `productCode`, `unitPrice`, `currency` |
| `SC_MULTIPLE_SUPPLIERS` | 4 | `scNumber`, `suppliers` |
| `PO_WITHOUT_SUPPLIER` | 3 | `purchaseOrder` |
| `INVALID_DATE` | 2 | `column`, `value` |
| `PO_IP_SUPPLIER_DIVERGENCE` | 1 | `purchaseOrder`, `ipNumber`, `poSupplier`, `ipSupplier` |

A carga histórica antiga (`import-historical-workbook.py`) também gera `EXCEL_CELL_ERROR`, `INVALID_NUMERIC`,
`INVALID_CURRENCY`, `INVALID_STATUS` e `INVALID_COST`; não há nenhum no HML hoje, mas a tela precisa explicá-los.

Medição prévia das regras sobre os dados atuais (POs e itens não cancelados, IPs ativos; reconferir na implementação):
item sem NCM 484, produto sem cadastro 388, preço sem moeda 77, NCM não cadastrada 23, PO sem fornecedor 3, item sem
preço 2, aprovação da PO antes da SC 64, desembaraço antes da chegada 33, IP sem PO 2, item em trânsito ou entregue sem
IP 1, e 0 para distribuído acima do pedido, IP com fornecedor diferente da PO e SC com mais de um fornecedor.

## Requisitos

### Entrega 1 — Tela clara (pendências da carga)

1. Cada código de erro da carga tem uma ficha nos três dicionários (`quality.issueTypes.<CODE>`): título, o que
   significa, por que importa e como corrigir. Código sem ficha aparece com um título genérico ("Erro não catalogado")
   e o código, sem quebrar a tela.
2. O cartão mostra o título da ficha, a planilha e a linha, o status traduzido (Aberta/Resolvida) e a severidade
   traduzida. O código técnico aparece só como detalhe secundário.
3. Ao abrir o cartão, a evidência aparece como campos rotulados (PO, produto, IP, importadora, fornecedores, valor
   encontrado, coluna). Cada chave conhecida da evidência tem rótulo nos três idiomas; chave desconhecida aparece com o
   próprio nome. O JSON bruto e os valores preservados da origem continuam em "Detalhes técnicos".
4. PO e IP da evidência viram links para `/purchase-orders/[id]` e `/processes/[id]` quando existem no sistema dentro do
   escopo da pessoa. A API resolve os ids pela linha de origem (observação da PO e vínculo da linha com o IP) ou, sem
   vínculo, pelo número normalizado dentro da importadora da linha, e devolve `links: { purchaseOrderId?, processId? }`
   por item. Sem correspondência única, não há link.
5. Uma faixa de resumo mostra a contagem por tipo no filtro de status atual; clicar num tipo filtra a lista e clicar de
   novo remove o filtro. A API devolve `countsByCode: { code, count }[]`, respeitando escopo e status.
6. O filtro de código digitado vira uma lista com os tipos existentes; entra uma busca por texto (`search`, até 80
   caracteres) que procura em PO, IP, produto e SC da evidência, sem diferenciar maiúsculas.
7. O formulário de resolução troca o JSON por dois campos: "Referência conferida" (obrigatória) e "Justificativa"
   (obrigatória), mais PO e IP propostos opcionais. A tela monta `evidence: { reference }` com uma função de `lib/`
   testada; o contrato de `POST /api/v1/data-issues/:id/resolve` não muda.
8. A tela usa o mesmo conjunto de papéis da API para mostrar o botão de revisão: Logística, que tem `quality.resolve`
   na API, passa a ver o botão.

### Entrega 2 — Regras sobre os dados atuais

9. Módulo `apps/api/src/quality-rules.ts` com um catálogo de regras. Cada regra tem código, grupo, tipo de entidade
   (`PURCHASE_ORDER`, `PURCHASE_ORDER_ITEM`, `IMPORT_PROCESS`, `PURCHASE_REQUEST`) e uma consulta SQL que devolve
   entidade, importadora, rótulos (PO, item, produto, IP, SC) e os valores conferidos.
10. Regras, todas ignorando PO `CANCELLED`, item com `source_status = 'CANCELLED'` e IP excluído ou não `ACTIVE`:

    | Grupo | Código | Condição |
    |---|---|---|
    | Cadastro incompleto | `ITEM_WITHOUT_NCM` | item sem NCM |
    | | `ITEM_NCM_NOT_REGISTERED` | NCM do item sem entrada `NCM` no catálogo |
    | | `ITEM_PRODUCT_NOT_REGISTERED` | código do item sem produto `ACTIVE`, global (`importer IS NULL`), por `normalized_code` |
    | | `ITEM_PRICE_WITHOUT_CURRENCY` | preço preenchido e moeda vazia |
    | | `ITEM_WITHOUT_PRICE` | preço vazio |
    | | `PO_WITHOUT_SUPPLIER` | PO sem `supplier_entry_id` e sem `supplier_text` |
    | Datas fora de ordem | `ITEM_PO_APPROVED_BEFORE_SC` | aprovação da PO anterior à aprovação da SC no item |
    | | `IP_CLEARED_BEFORE_ARRIVAL` | desembaraço anterior à chegada |
    | Vínculos e quantidades | `IP_WITHOUT_PO` | IP sem PO vinculada |
    | | `ITEM_SHIPPED_WITHOUT_IP` | item em `WAITING SHIPMENT`, `WAITING ARRIVAL`, `CUSTOMS CLEARANCE` ou `DELIVERED` sem distribuição ativa |
    | | `ITEM_OVER_ALLOCATED` | soma das distribuições ativas maior que a quantidade pedida |
    | | `IP_PO_SUPPLIER_MISMATCH` | fornecedor cadastrado do IP diferente do fornecedor cadastrado de uma PO vinculada |
    | | `SC_MULTIPLE_SUPPLIERS` | POs não canceladas da mesma SC com fornecedores cadastrados diferentes |

11. `GET /api/v1/quality/current` (`quality.read`) com `rule?`, `group?`, `search?`, `includeWaived` (padrão `false`),
    `page` e `pageSize` (até 200). Responde `countsByRule: { rule, group, open, waived }[]`, `totalCount` e `items` com
    `rule`, `group`, `entityType`, `entityId`, `importer`, `labels`, `values`, `links` e `waiver` (quando houver). Não
    grava nada. Escopo de importadora igual às demais rotas; Master vê tudo.
12. Dispensa ("dado correto"): `POST /api/v1/quality/current/waivers` com `rule`, `entityId`, `reason` (1 a 2000) e
    `Idempotency-Key`; `DELETE /api/v1/quality/current/waivers/:id` com `reason` desfaz. Ambas exigem
    `quality.resolve` e a entidade visível no escopo. A API recalcula a regra na gravação e recusa dispensar o que não
    está em erro (`QUALITY_RULE_NOT_VIOLATED`). Grava `audit.audit_log` e `audit.outbox_message` na mesma transação.
13. A dispensa guarda o SHA-256 dos valores conferidos (JSON canônico). Se os valores mudarem, a dispensa deixa de valer
    e o erro volta como aberto; a dispensa antiga continua no histórico.
14. Tabela nova na M077, `migration.quality_rule_waiver`: `id`, `rule_code`, `entity_type`, `entity_id`, `importer`,
    `values_sha256`, `values`, `reason`, `status` (`ACTIVE`/`REVOKED`), `created_by`, `created_at`, `revoked_by`,
    `revoked_at`, `revoke_reason`, `reviewer_user_id`, `idempotency_key`, `payload_sha256`. Índice único parcial de
    dispensa `ACTIVE` por regra e entidade. Grants no padrão da M074 para o papel da API. Aplicada só no HML.
15. Cada regra tem ficha nos três dicionários (`quality.ruleTypes.<CODE>`) com título, significado, impacto e correção,
    e cada grupo tem nome traduzido.
16. A tela ganha duas abas (`.tabs`/`.tab`): "Dados atuais" (padrão), com resumo por grupo e regra, lista, links e
    dispensa por `ConfirmDialog` com justificativa; e "Carga da planilha", com o conteúdo da entrega 1.

### Entrega 3 — Correções em massa

Medição no HML (2026-11-03): produto sem cadastro em 389 itens (371 códigos); preço sem moeda em 77 itens de 5 POs,
todas `ACTIVE`, e em 76 deles o fornecedor usa uma única moeda nas demais POs; item sem NCM em 484 itens (469
produtos; 402 em POs `ACTIVE` e 82 em `CLOSED`), nenhum dos 1.529 produtos do cadastro tem NCM e em 103 itens outro
item do mesmo produto tem NCM; NCM não cadastrada em 14 códigos; 86 `MISSING_PO` da carga.

17. Toda ação em massa segue dois passos com a mesma rota: `preview: true` devolve, por registro, o valor atual, o valor
    proposto e se será aplicado ou recusado (com o motivo); `preview: false` com `Idempotency-Key` e `reason` (8 a 500)
    grava numa transação única. A API recalcula tudo na gravação e não confia na prévia: registro que mudou, saiu do
    escopo ou deixou de estar em erro é recusado e listado no resultado (`applied`, `skipped` com motivo). Até 500
    registros por chamada.
18. A tela permite marcar cartões (um a um, "marcar todos do filtro" até 500) e mostra as ações disponíveis para a
    regra filtrada. A prévia abre em `ConfirmDialog` com a lista do que muda e o campo de justificativa.
19. Ações e regras:

    | Ação | Regra | Permissão | O que grava |
    |---|---|---|---|
    | Cadastrar produtos | `ITEM_PRODUCT_NOT_REGISTERED` | `catalog.write` (produto) | produto global `ACTIVE` com o código e a descrição mais frequente dos itens; código já cadastrado é pulado |
    | Cadastrar NCMs oficiais | `ITEM_NCM_NOT_REGISTERED` | `catalog.write` (NCM, global) | entrada `NCM` pela mesma lógica de `import-official`, usando o catálogo oficial em cache; código não vigente ou ausente é recusado; com a fonte em espera (`503`), nada é gravado e a tela mostra o horário de nova tentativa |
    | Aplicar moeda | `ITEM_PRICE_WITHOUT_CURRENCY` | `purchase-orders.write` | `currency_code` do item; proposta = moeda única do fornecedor nas outras POs, ou a moeda escolhida (valor de `CURRENCY` cadastrado) |
    | Copiar NCM de outro item | `ITEM_WITHOUT_NCM` | `purchase-orders.write` | `ncm` do item com o NCM único já usado em outro item do mesmo produto; produto com mais de um NCM é recusado |
    | Informar NCM do produto | `ITEM_WITHOUT_NCM` | `catalog.write` e `purchase-orders.write` | `product_ncm_code` do produto só se vazio (mesma regra da invoice) e `ncm` dos itens vazios desse produto; NCM precisa estar cadastrada e `ACTIVE` |
    | Dispensar em lote | qualquer regra atual | `quality.resolve` | uma dispensa por registro, com a mesma justificativa |
    | Resolver em lote | pendências da carga | `quality.resolve` | uma revisão por pendência, com a mesma referência e justificativa |

20. Itens de PO só mudam em PO `ACTIVE` (mesma regra de `assertPoActive`); os demais aparecem na prévia como recusados
    ("PO encerrada"). Cada PO alterada tem a versão incrementada uma vez. A gravação grava `audit.audit_log` por
    registro, com o mesmo `correlation_id` para o lote, e um evento de outbox por lote.
21. As ações em massa nunca alteram quantidade, preço, produto, descrição ou fornecedor de item ou PO, nem sobrescrevem
    NCM ou moeda já preenchidos.

## Restrições

- Textos só pelos dicionários `apps/web/lib/i18n/` (pt-BR, en, zh-CN); códigos de regra, status e chaves de evidência
  trocados com a API continuam como estão e são marcados com `// i18n-ignore:` quando literais.
- Funções de `lib/` recebem `m: Messages` por parâmetro e não importam valores de outros módulos de `lib/`.
- Layout: componentes padrão (`PageHeader`, `.badge`, `.notice`, `.tabs`, `ConfirmDialog`, `Tooltip`), cores só por
  tokens, regras novas em `app/styles/features/analysis.css`, sem classes sem regra.
- As regras só leem. Só as ações em massa da entrega 3 gravam, e apenas os campos listados no requisito 19.
- `migration.data_issue` e o script de carga não mudam. As pendências da carga continuam com o fluxo de revisão atual.
- Migrations e testes de banco só no HML (`erp_po_totvs_hml`), com backup antes de aplicar a M077 e pacote gerado com
  `git -c core.autocrlf=false archive`.

## Critérios de aceite

1. Nenhum cartão exibe código cru como título nem `OPEN`/`RESOLVED`/`WARNING` sem tradução (teste da tela e dos
   dicionários).
2. Todo código de carga conhecido e toda regra têm ficha completa nos três idiomas (teste de cobertura).
3. A evidência aparece rotulada e a função de rótulos trata chave desconhecida e valor nulo ou lista (teste de `lib/`).
4. `GET /api/v1/data-issues` devolve `countsByCode`, `links` e aceita `search`, respeitando escopo (teste da API).
5. O payload de resolução montado pela tela é aceito pelo schema da API (teste de contrato).
6. Logística vê o botão de revisão (teste de permissões web contra a matriz da API).
7. Cada regra tem um caso que dispara e um que não dispara, inclusive exclusão de cancelados (teste da API).
8. `GET /api/v1/quality/current` respeita o escopo de importadora e a paginação (teste da API).
9. Dispensa grava auditoria e outbox, é idempotente, recusa regra não violada, e perde efeito quando o valor muda
   (teste da API).
10. No HML, as contagens da rota batem com consultas SQL independentes feitas na validação.
11. Cada ação em massa tem teste de prévia, de gravação, de recusa (PO encerrada, valor já preenchido, registro
    alterado entre prévia e gravação, fora do escopo, sem permissão) e de idempotência (teste da API).
12. As ações em massa nunca tocam campos fora do requisito 19 (teste da API sobre o SQL gerado).
13. Testes, lint, type-check e build passam em `apps/api` e `apps/web`; Preview `Ready` e API HML respondendo à rota nova.

## Fora do escopo

- Corrigir dados além das ações do requisito 19 (por exemplo, fornecedor da PO, datas ou vínculos).
- Alterar PO encerrada ou cancelada.
- Alterar o script de carga ou as pendências gravadas por ele.
- Regras tributárias ou de despacho.
- Rodar regras ou aplicar a M077 em produção.
- Notificações, exportação Excel ou histórico de quando cada erro surgiu.

## Plano

1. Entrega 1, API: `countsByCode`, `search` e `links` em `data-issues.ts`, com testes.
2. Entrega 1, web: fichas e rótulos nos dicionários, funções de `lib/` (ficha, rótulos da evidência, payload de
   resolução, papéis), tela reescrita, CSS, testes.
3. Verificação, commit, push na `homologacao`, deploy da API no HML e validação no Preview.
4. Entrega 2, banco: M077 com teste de migration; backup e aplicação no HML.
5. Entrega 2, API: `quality-rules.ts`, rota de leitura, dispensas, testes.
6. Entrega 2, web: aba "Dados atuais", fichas das regras, dispensa, testes.
7. Verificação, commit, push, deploy da API, conferência das contagens no HML e validação no Preview.
8. Entrega 3, API: rotas de ação em massa com prévia e gravação, testes.
9. Entrega 3, web: seleção, prévia, confirmação e resultado, testes.
10. Verificação, commit, push, deploy da API e validação no HML com uma ação em massa pequena e reversível, conferindo
    auditoria e contagens.
