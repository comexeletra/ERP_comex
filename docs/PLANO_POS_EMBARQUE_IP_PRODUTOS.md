# Pós-embarque do IP nos produtos — análise de cobertura e plano

Situação em 2026-10-22, branch `homologacao` (`1168576`). Consultas somente leitura (`BEGIN READ ONLY` … `ROLLBACK`, apenas contagens) no HML `erp_po_totvs_hml` (M001–M067) e, com autorização do usuário, no banco operacional `erp_po_totvs_test` (M001–M034). Nenhum dado foi gravado ou copiado. As decisões D1–D5 foram confirmadas pelo usuário em 2026-10-22 (seção 6).

## 1. Regra de negócio

- **Um IP é um embarque** (D2). Ele reúne produtos de várias POs, na quantidade total ou parcial de cada item. A parcela de um item dentro de um IP é a **distribuição** (`procurement.po_item_allocation`: item × IP × quantidade).
- Os dados de pós-embarque pertencem ao IP e são editados somente nele (D1). Cada distribuição exibe os dados do seu IP, e a parcela do mesmo item em outro IP exibe os dados desse outro IP. O saldo ainda não distribuído não tem pós-embarque. Se parte da carga sair ou chegar em outra data, essa parte é redistribuída para outro IP.
- A planilha `Follow Up Import 2026 - Copiar.xlsx` faz essa ligação nos dois sentidos:
  - **Pré Embarque** (uma linha por produto) busca no IP, por `VLOOKUP` do IP Number: ETA, Arrival, Duimp, Duimp Date, Channel, Clearance, NF Request, NF, NF Issue Date e Delivery Date.
  - **Pós Embarque** (uma linha por IP) agrega das linhas de produto, por `UNIQUE(FILTER(...))`: Mode, Incoterm, POL, POD, Broker, BL Number, ETD, ETE e BL Date. Invoice vem por `TEXTJOIN` e Total Amount por `SUMIFS`. Quando duas linhas do mesmo IP divergem, a fórmula devolve mais de um valor. No sistema, o IP é o dono único desses dados, e essa divergência deixa de existir.

## 2. Onde cada dado está

| Dado pedido | Fonte no sistema | Dono |
|---|---|---|
| ETD | `import_process.etd` | IP |
| ETA | `eta_confirmed`; sem ele, ETD + 55 dias (modal SEA) ou + 10 dias (outros modais) — [followup-calculations.ts:66](../apps/api/src/followup-calculations.ts#L66) | IP |
| ETE | `ete_confirmed`; sem ele, ETA + 10 dias — [followup-calculations.ts:67](../apps/api/src/followup-calculations.ts#L67) | IP |
| Departure | `actual_port_departure_date` (M024) | IP |
| BL date e BL nº | **Hoje:** data de emissão e número do documento BL ([followup-calculations.ts:62](../apps/api/src/followup-calculations.ts#L62)). **Decidido (D3):** campos `bl_date` e `bl_number` digitados no IP (M068) | IP |
| Arrived | `arrival_date` | IP |
| Saída da fábrica | `po_item_allocation.factory_ship_date` (M025) | distribuição |

**Modelo: herança por referência (D1).** Nenhuma data é copiada para o item. `GET /purchase-orders/:id/followup` junta cada distribuição ativa ao seu IP e calcula os indicadores por parcela (`shipments`, [followup.ts:543](../apps/api/src/followup.ts#L543)). `GET /processes/:id/followup` faz o mesmo pelo lado do IP ([followup.ts:418](../apps/api/src/followup.ts#L418)). Uma alteração no IP aparece imediatamente em todas as POs e produtos dele, sem rotina de sincronização. Cancelar ou reduzir uma distribuição devolve a quantidade ao saldo, que fica sem pós-embarque.

### Demais dados do IP e como chegam ao produto

| Grupo | Campos | Na linha do produto |
|---|---|---|
| Identificação | nº do IP, data do IP no TOTVS, status, prioridade do IP, fornecedor do IP | exibir |
| Embarque | modal, Incoterm, despachante, POL, POD, ETD, Departure, BL nº/data, agente de carga, container/tipo | exibir |
| Chegada e aduana | ETA, Arrival, DUIMP/data, canal, desembaraço, ETE, vencimento da armazenagem, documentação conferida | exibir |
| Fechamento | solicitação da NF, NF nº/emissão/homologação, entrega | exibir |
| Invoice | nº; quantidade e preço quando a linha da invoice aponta para o item | exibir por item |
| Custos | frete, impostos, multa, armazenagem, demurrage, qtd. de containers | **não propagar**; mostrar só no IP (somar por produto duplica o valor) |
| Calculados | status, alerta, risco de ruptura, trânsito, lead time, etapas T2–T5, desvios, gargalo, mês de chegada | calcular por parcela (datas do IP + necessidade e metas do item) |

## 3. Cobertura por tela e rota

| Ponto de consulta | Mostra os dados do IP por produto? | Observação |
|---|---|---|
| PO › Acompanhamento, linhas por IP ([FollowupPanel.tsx](../apps/web/components/FollowupPanel.tsx)) | Parcial | Na tabela: status, ETA e entrega. No detalhe: campos do IP, exceto Departure. BL date só em "Indicadores calculados" |
| PO › Preenchimento operacional, distribuições ([OperationalPoPanel.tsx](../apps/web/components/OperationalPoPanel.tsx)) | Não | Mostra IP, quantidade e saída da fábrica |
| IP › Pós-Embarque, tabela de itens ([ProcessPostShipmentPanel.tsx](../apps/web/components/ProcessPostShipmentPanel.tsx)) | Parcial | Mostra quantidade, saída da fábrica, status e alerta. Não mostra a ETA/ETE calculadas |
| Carteira de POs: lista e resumo ([purchase-orders.ts:146](../apps/api/src/purchase-orders.ts#L146)) | Não | Contagens por PO |
| Exportação da carteira ([purchase-order-exports.ts](../apps/api/src/purchase-order-exports.ts)) | Não | Contagens por PO |
| Relatórios Pré/Pós ([source-audit.ts:106](../apps/api/src/source-audit.ts#L106)) | Não | Contagens de POs e de IPs; status do IP agrupado pelo valor manual |
| Histórico da PO | Sim | Os eventos dos IPs vinculados aparecem na PO |

## 4. Lacunas

- **L1 — Não há visão por produto.** A herança só aparece dentro de cada PO. Não existe uma lista de todas as linhas (produto × IP, mais o saldo) com as datas do IP, filtros e exportação. Essa lista substitui a aba Pré Embarque e é a principal lacuna.
- **L2 — O status manual congela o status do produto.** O cálculo usa `logistics_status` sempre que ele está preenchido ([followup-calculations.ts:115](../apps/api/src/followup-calculations.ts#L115)), e a carga de invoice grava `WAITING SHIPMENT` ([operations.ts:1311](../apps/api/src/operations.ts#L1311), [:1331](../apps/api/src/operations.ts#L1331)). Depois disso, lançar BL, chegada ou entrega muda o alerta, mas não o status da linha. Na planilha, o status é sempre derivado das datas. No histórico de produção, os status estão coerentes com as datas; o problema afeta os IPs novos.
- **L3 — Departure não aparece na PO.** A lista de campos de [FollowupPanel.tsx:14](../apps/web/components/FollowupPanel.tsx#L14) omite `actualPortDepartureDate`, presente em [ProcessPostShipmentPanel.tsx:33](../apps/web/components/ProcessPostShipmentPanel.tsx#L33). O valor não é apagado, porque o PATCH grava só as chaves enviadas. A causa é que as duas listas de campos são cópias independentes.
- **L4 — BL date não é digitado no IP, e BL, Invoice e NF não são colunas da linha.** Hoje o BL date depende de cadastrar um documento BL e fica nos indicadores; os números ficam só na lista de documentos do IP. O cálculo devolve `billDate` e `nfIssueDate`, mas não os números.
- **L5 — Não há consolidação por item nem por PO.** Exemplo: um item de 100 unidades com 60 entregues e 40 em trânsito. Faltam a quantidade por fase, a próxima ETA e um status agregado.
- **L6 — A distribuição pode mudar depois do embarque.** POST, PATCH e DELETE em `/allocations` exigem apenas IP aberto e ativo ([operations.ts:2308](../apps/api/src/operations.ts#L2308), [:2353](../apps/api/src/operations.ts#L2353), [:2391](../apps/api/src/operations.ts#L2391)). Com BL ou Departure lançados, a quantidade embarcada pode ser alterada, e a tela envia uma justificativa automática. A revisão de invoice também recria distribuições.
- **L7 — Não há validação de sequência das datas.** `validateFields` confere só o tipo ([followup.ts:57](../apps/api/src/followup.ts#L57)).
- **L8 — O IP não mostra a ETA/ETE calculadas.** Elas aparecem apenas nas linhas da PO.
- **L9 — Eventos.** Alterar o IP gera somente `comex.import_process.followup_update`. Isso basta enquanto não houver consumidor externo por item.

## 5. Dados reais (2026-10-22)

| Medida | Produção (M034) | HML (M067) |
|---|---:|---:|
| IPs | 204 abertos (200 da planilha) | 3, todos `DELETED` |
| POs | 342 | 12 (11 `DELETED`) |
| Itens / cancelados na origem | 6.800 / 642 | 446 / — |
| Distribuições ativas (itens, IPs) | 5.155 (5.154, 199) | 0 |
| Itens em mais de um IP / com saldo restante | 1 / 1 | 0 / 0 |
| IPs com mais de uma PO | 91 | 0 |
| Vínculos PO–IP sem distribuição | 0 | 0 |
| Itens com IP na origem e sem distribuição | 0 | — |
| Datas antigas gravadas no item (`actual_*` em `purchase_order_item`) | 0 | 0 |
| IPs com ETD / ETA / ETE / modal | 199 cada | 0 |
| IPs com Departure / Arrival / entrega | 0 / 165 / 170 | 0 |
| BL / Invoice / NF ativos (ligados a item) | 190 / 190 / 159 (todos gerais, nenhum ligado a item) | 0 |
| BLs ativos com data de emissão | 188 de 190 | 0 |
| Invoices com data de emissão | 0 de 190 | — |
| IPs com mais de um BL | 0 | 0 |
| Chegada antes do ETD / desembaraço antes da chegada / ETE antes da ETA | 8 / 17 / 2 | — |
| Chegada antes da Departure / entrega antes da chegada / ETA antes do ETD | 0 / 0 / 0 | — |
| Distribuições ativas em IP com BL ou Departure | 4.893 | 0 |
| Conflitos da planilha abertos (`IP_SOURCE_CONFLICT` / `PO_SOURCE_CONFLICT`) | 242 / 10 | — |

"—" indica medida não feita ou que não se aplica a esse banco.

O que esses números mostram:

- Não há data antiga no item para reconciliar, e todo item com IP na origem já tem distribuição. O histórico já herda por referência.
- Cada IP tem no máximo um BL ativo. O preenchimento dos novos campos de BL (D3) a partir dos BLs existentes não é ambíguo.
- O HML não tem nenhuma distribuição ativa, então a validação depende de dados sintéticos (ou de cópia autorizada de entidades específicas).
- Departure é um dado novo: a planilha não tinha essa coluna no Pós Embarque.
- Uma validação rígida de sequência bloquearia IPs históricos. Ver D6.
- Produção está 33 migrations atrás do HML. Este trabalho depende da promoção de M035–M067.

## 6. Decisões

Confirmadas pelo usuário em 2026-10-22:

- **D1 — Herança por referência.** As datas de pós-embarque são editadas só no IP. Os produtos apenas exibem os dados do IP em que estão; nada é copiado para o item nem para a distribuição.
- **D2 — Um IP é um embarque.** Toda a quantidade de um IP compartilha as mesmas datas. Se parte da carga sair ou chegar em outra data, essa parte é redistribuída para outro IP.
- **D3 — BL nº e BL date são campos digitados no IP**, no formulário de pós-embarque, junto com ETD/ETA.
  - Migration M068 cria `bl_number` e `bl_date` em `imports.import_process` e os preenche a partir do BL ativo do IP.
  - O tipo BL deixa de ser oferecido em novos documentos; os BLs já cadastrados ficam como histórico.
- **D4 — Status calculado pelas datas.** O status exibido no IP, nas linhas, nas listas e nos relatórios é o calculado. O campo de status informado continua existindo e só prevalece quando for `CANCELLED`. A carga de invoice deixa de gravar `WAITING SHIPMENT`.
- **D5 — Distribuição em IP embarcado.** IP embarcado é o que tem BL date ou Departure preenchidos. Nele, criar, alterar ou cancelar distribuição (inclusive pela revisão de invoice) exige confirmação explícita e justificativa digitada pelo usuário. O caso é raro, mas fica coberto.

Seguem a recomendação, salvo objeção do usuário:

- **D6 — Sequência das datas.** Bloquear somente o fisicamente impossível entre datas efetivas, e apenas quando a edição altera uma das datas envolvidas: chegada antes da Departure, entrega antes da chegada e ETA antes do ETD. Os demais casos geram só aviso, porque existem no histórico: chegada antes do ETD, desembaraço antes da chegada, ETE antes da ETA e BL date depois da Departure.
- **D7 — Custos ficam no IP.** Frete, impostos e demurrage não aparecem por produto. Um eventual rateio é tarefa separada.
- **D8 — ETA/ETE calculadas.** Manter a regra atual e mostrar "confirmada" e "calculada" lado a lado. A planilha também projeta a ETE sem ETD (hoje + 10 + trânsito + 10); essa projeção só será replicada se a operação confirmar.
- **D9 — Saldo sem IP na carteira por produto.** Mostrar uma linha "A distribuir" com a quantidade restante e sem datas.

## 7. Spec

```markdown
# Tarefa: pós-embarque do IP visível e coerente em cada produto
## Objetivo
Cada parcela de produto dentro de um IP mostra os dados de pós-embarque desse IP
(ETD, Departure, BL nº/date, ETA, Arrival, ETE, entrega e demais campos), em todas as
telas e exportações, sem cópia de dados e com regras que mantêm datas e quantidades coerentes.
## Requisitos
- BL nº e BL date digitados no IP (M068), preenchidos a partir do BL ativo existente; novos documentos não aceitam o tipo BL.
- Uma única montagem da linha produto × IP na API, usada por PO, IP, carteira por produto e exportação.
- Linha: dados do item + quantidade no IP + todos os campos do IP + Invoice/NF + calculados; saldo sem IP como "A distribuir".
- Status calculado a partir das datas, inclusive no IP, nas listas e nos relatórios (D4).
- Catálogo único de campos do IP no web, igual ao aceito pela API (corrige Departure na PO).
- ETA/ETE calculadas visíveis no IP.
- Validação de sequência (D6) e confirmação para mudar distribuição de IP embarcado (D5).
- Carteira por produto com filtros, consolidação por item e exportação XLSX.
## Restrições
- IP continua dono único; nenhuma gravação em purchase_order_item ao editar o IP.
- Manter campos atuais das respostas; campos novos opcionais (web publicada pode falar com API antiga).
- Escopo por importadora, auditoria e versionamento iguais aos atuais.
- Única migration prevista: M068, validada em cópia restaurada e aplicada somente no HML até aprovação.
## Critérios de aceite
- M068 copia número e data do BL ativo para o IP e falha se algum IP tiver mais de um BL ativo com valores diferentes.
- BL nº e BL date editados no IP aparecem em todas as linhas de produto do IP; POST de documento BL retorna 400.
- Item dividido em dois IPs mostra datas independentes; itens de POs diferentes no mesmo IP mostram as mesmas datas.
- Alterar uma data do IP reflete em todas as linhas sem atualizar purchase_order_item.
- Status da linha e do IP avança com BL/chegada/entrega em IP criado por invoice.
- Datas impossíveis retornam IP_DATE_SEQUENCE_INVALID; casos históricos só geram aviso.
- Mudança de distribuição em IP embarcado sem confirmação retorna 409.
- Teste garante que o catálogo de campos do web é igual ao processFields da API.
- Carteira por produto e exportação respeitam filtros, escopo e paginação; custos não aparecem por produto.
## Fora do escopo
- Rateio de custos por produto; integração TOTVS; datas próprias por distribuição (D2);
  eventos outbox por produto; mudança no layout da planilha.
## Plano
Fases 0–8 abaixo.
```

## 8. Plano de implementação

Cada fase segue o mesmo ciclo: testes primeiro; `corepack pnpm test` e `corepack pnpm build` em `apps/api`; `corepack pnpm test`, `corepack pnpm lint` e `corepack pnpm build` em `apps/web`; commit na `homologacao`.

**Fase 0 — Decisões e linha de base**
1. D1–D5 confirmadas; D6–D9 seguem a recomendação, salvo objeção.
2. Linha de base registrada em 2026-10-22 (`1168576`): API com build ok e 210 testes aprovados, 0 falhas; web com 94 testes aprovados, lint com 0 erros (40 avisos preexistentes) e build ok.
3. Definir os dados de validação no HML: cenário sintético com prefixo `HMLVAL-` e limpeza ao final, ou cópia de IPs/POs escolhidos da produção, somente se solicitada explicitamente.

**Fase 1 — BL nº e BL date no IP** (D3, migration M068)
1. Criar `M068_ip_bill_of_lading_fields.sql`:
   - Adiciona `bl_number varchar(120)` e `bl_date date` em `imports.import_process`.
   - Pré-checagem: falha se algum IP tiver mais de um BL ativo com número ou data diferentes, no padrão de M026. Hoje são 0 IPs.
   - Preenche os dois campos a partir do BL ativo, só onde estiverem nulos.
   - Mantém os documentos BL como histórico.
   - Registrar a migration em `apps/api/migrations/README.md`.
2. Validar a M068 em cópia restaurada do HML; fazer backup e aplicar somente no HML.
3. API:
   - `processFields` passa a aceitar `blNumber` e `blDate`.
   - `calculateFollowup` usa `process.blDate`/`blNumber` no lugar dos documentos BL (status, alerta, etapa de embarque, PO até BL, trânsito real).
   - `POST /processes/:id/documents` com `kind: "BL"` responde `BL_IS_IP_FIELD` (400). Os BLs existentes continuam legíveis e podem ser cancelados.
4. Testes:
   - Teste de SQL da M068, no padrão de `invoice-migrations.test.mjs`.
   - `followup-calculations.test.mjs` com `blDate` do IP.
   - Rota de documentos rejeitando BL.
   - Contrato web × API.

**Fase 2 — Linha produto × IP única e status calculado**
1. Criar `apps/api/src/shipment-lines.ts`, que monta uma linha por distribuição ativa e uma por saldo restante, juntando PO, item, distribuição, IP e documentos.
2. Extrair o status do IP para uma função usada por linha e por IP (D4); o status informado só prevalece se for `CANCELLED`. A carga de invoice deixa de gravar `WAITING SHIPMENT` ([operations.ts:1311](../apps/api/src/operations.ts#L1311), [:1331](../apps/api/src/operations.ts#L1331)).
3. `calculateFollowup` passa a devolver também `blNumber`, `invoiceNumbers`, `nfNumber`, `statusSource` (calculado/informado) e avisos de regra.
4. `GET /purchase-orders/:id/followup` e `GET /processes/:id/followup` passam a usar o módulo, mantendo os campos atuais da resposta.
5. Testes:
   - `followup-calculations.test.mjs`: status derivado mesmo com `WAITING SHIPMENT`; `CANCELLED` informado prevalece; ETA/ETE confirmada × calculada.
   - `shipment-lines.test.mjs`, no padrão de `operations.test.mjs`.
   - `operations.test.mjs`: a carga de invoice deixa de gravar `WAITING SHIPMENT`.

**Fase 3 — Telas atuais**
1. Criar `apps/web/lib/ip-post-shipment-fields.ts` com o catálogo único (incluindo Departure, BL nº e BL date), usado por FollowupPanel e ProcessPostShipmentPanel (corrige L3).
2. Retirar a opção BL dos formulários de novo documento; os BLs antigos aparecem como histórico.
3. PO › linhas por IP: colunas ETD, Departure, BL date, ETA, Arrival, ETE, entrega e status. No detalhe, BL nº e os números de Invoice e NF.
4. IP › Pós-Embarque: status calculado ao lado do informado; ETA/ETE calculadas ao lado das confirmadas (L8); Invoice por item na tabela de itens quando houver documento ligado ao item.
5. Testes:
   - Contrato API × web: as chaves de `processFields` coincidem com o catálogo (`web-route-contract.test.mjs`).
   - Testes de rótulos no padrão de `invoice-review-layout.test.mjs`.

**Fase 4 — Regras de integridade** (D5, D6)
1. `PATCH /processes/:id/followup` valida a sequência sobre o estado resultante (valores atuais + enviados), só para as datas alteradas. O erro é `IP_DATE_SEQUENCE_INVALID` (400) com a lista de campos; os avisos voltam na resposta.
2. Em IP com BL date ou Departure, POST, PATCH e DELETE em `/allocations` e a revisão de invoice respondem `IP_ALREADY_SHIPPED_UNCONFIRMED` (409) sem `confirmShippedChange: true` e justificativa digitada. A confirmação fica registrada na auditoria.
3. Telas: mensagens e diálogo de confirmação com justificativa obrigatória.
4. Testes em `operations.test.mjs` e um teste novo para a sequência de datas.

**Fase 5 — Carteira por produto**
1. Criar `GET /api/v1/purchase-order-lines`:
   - Filtros: importadora, PO, IP, produto, status, período de ETA/chegada e "somente com saldo".
   - Paginação, escopo por importadora e permissão `purchase-orders.read`.
   - O filtro por status calculado exige a mesma regra em SQL, com teste de paridade contra a função da Fase 2.
2. Criar a tela `/purchase-orders/lines` ("Carteira por produto"):
   - Link no AppSidebar, colunas agrupadas Pré | Pós e links para PO e IP.
   - Consolidação por item (L5): a distribuir, quantidade por fase e próxima ETA.
3. Listas e relatórios que agrupam por status do IP ([source-audit.ts:150](../apps/api/src/source-audit.ts#L150)) passam a usar o status calculado (D4).
4. O índice único `uq_active_po_item_process (item, IP) WHERE ACTIVE` já cobre a busca por item. Só criar índice novo se o `EXPLAIN` no volume real mostrar necessidade.
5. Testes da rota (filtros, escopo, paginação, saldo) e do contrato web × API.

**Fase 6 — Exportação por produto**
1. Criar o job `purchase-order-lines-xlsx` em `export-jobs.ts` e `worker.ts`, com os mesmos filtros e as colunas na ordem da aba Pré Embarque (B:AZ), para facilitar a comparação com a planilha.
2. Testes em `purchase-order-export.test.mjs`.

**Fase 7 — Pendências do histórico**
1. O módulo de Qualidade ([data-issues.ts](../apps/api/src/data-issues.ts)) já lista e revisa pendências por código. No IP e na linha do produto, mostrar um aviso quando houver `IP_SOURCE_CONFLICT` aberto (242 em produção), com link para a revisão nesse módulo. Nada é corrigido automaticamente.
2. Usar os avisos de sequência (D6) para sinalizar os 8 IPs com chegada antes do ETD, os 17 com desembaraço antes da chegada e os 2 com ETE antes da ETA, para revisão pela operação.

**Fase 8 — Homologação**
1. `git push production homologacao`; acompanhar o Preview até `Ready` no domínio estável.
2. Publicar a API na VPS HML (o Preview não atualiza a VPS). Confirmar a M068 aplicada no HML e conferir as rotas novas e alteradas.
3. Criar o teste opt-in `test/post-shipment-propagation-hml.integration.mjs` com este roteiro:
   - PO-A com item de 100: 60 no IP-1 e 40 no IP-2. PO-B com item de 50, todo no IP-1.
   - BL nº, BL date e demais datas do IP-1 aparecem nas linhas da PO-A (60) e da PO-B (50), e não na linha do IP-2.
   - Alterar a ETA do IP-1 reflete nas duas POs.
   - O status avança ao lançar BL date, chegada e entrega.
   - Reduzir de 40 para 30 devolve 10 ao saldo, sem datas.
   - Mudar a distribuição depois de lançar a Departure exige confirmação.
   - Limpar os dados ao final.
4. Validar no Preview a carteira por produto e a exportação.

## 9. Riscos

- **Promoção da M068 para produção.** Em produção, a M068 preenche 188 BL dates e 190 números de BL; ela precisa de cópia restaurada e backup antes, como as migrations anteriores.
- **D4 muda o status exibido nos IPs criados por invoice e nos relatórios.** O status manual deixa de prevalecer; é preciso comunicar a operação.
- **Divergência entre TS e SQL.** A regra de status em TS e os filtros em SQL podem divergir; o teste de paridade é obrigatório na Fase 5.
- **Validação só com dados sintéticos.** O HML não tem distribuições, então o volume real (cerca de 6,8 mil itens) só será exercitado com dados autorizados ou em cópia restaurada.
- **Promoção para produção.** A produção está em M034; liberar este trabalho em produção exige promover antes M035–M067.
- **Compatibilidade de versões.** O web publicado pode conversar com uma API antiga na VPS. Por isso, os campos novos são opcionais, e a ausência deles é tratada pelo padrão `compatibilityWarning` já usado nas telas.
