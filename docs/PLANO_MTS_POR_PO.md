# Tarefa: MTS / Não MTS por PO

## Objetivo
O tipo de demanda (MTS ou Não MTS) é da PO, não do produto. Ele fica num único campo da PO e vale para todos os
produtos dela, inclusive no End to End (T3: 30 dias MTS, 45 dias Não MTS).

## Requisitos
1. **Banco (M071, só HML):** cria `procurement.purchase_order.demand_type` (varchar(40), nulo ou não vazio) e remove
   `procurement.purchase_order_item.demand_type`. Antes de remover, leva para a PO o valor dos produtos quando todos
   os preenchidos da PO têm o mesmo valor; PO com valores misturados fica sem tipo. A lista `DEMAND_TYPE` não muda.
2. **API:**
   - o cabeçalho da PO aceita `demandType` ao criar (`POST /purchase-orders`, `POST /purchase-orders/complete`) e ao
     editar (`PATCH /purchase-orders/:id`, `PATCH /purchase-orders/:id/complete`); ausente mantém o valor atual;
   - `demandType` deixa de ser campo de produto: as rotas de follow-up de produto o recusam com `INVALID_FOLLOWUP`;
   - toda leitura que hoje devolve `item.demandType` passa a devolver o valor da PO em cada produto (detalhe da PO,
     follow-up do IP, linhas por produto/End to End, exportação "Demand Type"), e o detalhe da PO também o devolve no
     cabeçalho;
   - o cálculo do End to End e o filtro MTS/Não MTS seguem iguais, lendo o valor herdado.
3. **Web:**
   - o campo "Tipo de demanda" sai dos campos do produto e entra nos "Dados da PO" (edição) e no cabeçalho da Nova PO;
   - os produtos não editam o tipo.
4. **Simulações HML:**
   - PO 030201: o tipo fica na PO como **MTS**; os 7 IPs (A–G) continuam como estão;
   - nova PO de simulação **Não MTS**, criada pela API (auditoria e outbox), com os 59 produtos das linhas
     0154–0212 da 030201 (mesmos códigos, quantidades e preços), mesmo fornecedor, importadora e datas de
     pré-embarque, e dois IPs: um aéreo em desembaraço e um marítimo aguardando embarque, com datas coerentes com os
     45 dias de produção;
   - `revert` desfaz as duas simulações (alocações, faturas, IPs e a PO nova).

## Restrições
- M069 não é alterada (já registrada no ledger do HML); a mudança vem numa migration nova.
- Valores trocados com a API continuam em português (`MTS`, `Não MTS`).
- Textos de tela nos três dicionários; estilos só com tokens.
- Banco: só `erp_po_totvs_hml`; produção e `main` não mudam nesta tarefa.

## Critérios de aceite
1. Teste de migration: M071 cria a coluna na PO, copia valores uniformes, remove a do produto e não toca outras tabelas.
2. Teste de API: cabeçalho aceita e grava `demandType`; follow-up de produto recusa `demandType`; leituras devolvem o
   valor da PO em cada produto.
3. Teste do cálculo: dois produtos da mesma PO sempre recebem o mesmo T3.
4. Teste web: `demandType` não está em `purchaseOrderItemFields` e está no formulário da PO; três dicionários
   completos; `i18n-coverage` e `layout-consistency` passam.
5. Teste das simulações: 030201 toda MTS; PO nova toda Não MTS, com status e ETA esperados por IP.
6. HML: M071 aplicada após backup; API nova publicada; 030201 com tipo MTS na PO e a PO nova com 59 produtos
   Não MTS, conferidos por consulta.

## Fora do escopo
- Mudar prazos, metas ou o modelo do End to End.
- Tipo por produto como exceção.
- Promover para `main`/produção.

## Plano
1. Testes (migration, API, cálculo, web, simulações) e confirmar que falham.
2. M071 e README das migrations.
3. API: cabeçalho, leituras e recusa no produto.
4. Web: formulário da PO, campos do produto, dicionários.
5. Simulações: 030201 MTS e PO nova Não MTS.
6. Lint, type-check, testes e build; commits por etapa; push em `homologacao`.
7. HML: backup, M071, release da API, rodar as simulações, conferir no banco e no Preview.
