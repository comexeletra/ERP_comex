# Plano — Varredura do ciclo de criação da PO (manual e upload TOTVS)

| Item | Valor |
|---|---|
| Data | 2026-10-21 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Arquivo de referência | `PO 030201.xlsx` (export TOTVS "1-Pedido de Compras Autoriz", 215 itens) |
| Status | **Autorização recebida em 2026-10-21. Ciclos 1–4 e melhorias F2–F5 implementados na branch `homologacao`; suíte web com 70 testes, lint sem erros, type-check e build passaram. M065 foi aplicada somente no HML após backup e validação em cópia restaurada; a API HML está ativa no release `6a18999`. A validação autenticada no HML passou para pré-validação, criação sintética, reimportação, remoção de item e troca de importadora; a PO 030201 permaneceu inalterada e a credencial temporária foi restaurada. O check Vercel do commit `6a18999` está `success`, mas o domínio estável respondeu HTTP 302 para `vercel.com/sso-api`, impedindo validar a aplicação pela web. E3 permanece excluído, sem aprovação específica.** |

## Sumário

1. [Resumo executivo](#1-resumo-executivo)
2. [Como o fluxo funciona hoje](#2-como-o-fluxo-funciona-hoje)
3. [Evidências coletadas](#3-evidências-coletadas)
4. [Lacunas encontradas](#4-lacunas-encontradas)
5. [Mapa de distribuição dos dados da planilha](#5-mapa-de-distribuição-dos-dados-da-planilha)
6. [Decisões de negócio](#6-decisões-de-negócio)
7. [Preço de referência do produto](#7-preço-de-referência-do-produto)
8. [Especificação](#8-especificação)
9. [Ciclos de entrega](#9-ciclos-de-entrega)
10. [PO 030201 do HML como dado de teste](#10-po-030201-do-hml-como-dado-de-teste)
11. [Arquivos afetados](#11-arquivos-afetados)
12. [Riscos e cuidados](#12-riscos-e-cuidados)

---

## 1. Resumo executivo

O cadastro de PO (manual e por planilha) grava os itens, mas o upload aproveita só 7 das 36
colunas do export TOTVS e lê o preço da coluna errada. A PO 030201 do HML, criada pelo upload de
`PO 030201.xlsx`, confirma os efeitos: preços incorretos e importadora e fornecedor diferentes
dos da planilha.

| # | Lacuna | Severidade | Evidência no HML |
|---|---|---|---|
| L1 | Preço unitário lido de `Valor Unitario`, que o TOTVS exporta arredondado a 2 casas | **Crítica** | 48 itens com preço `0,00 CNY`; demais arredondados (ex.: 0,01 em vez de 0,00589). Nenhum item da planilha tem `Valor Total` zero |
| L2 | Importadora não é derivada do CNPJ da planilha; a criação lista importadoras legadas sem CNPJ | **Crítica** | PO gravada em `Eletra Cwb`; CNPJ da planilha `12.115.480/0001-15` = `ELETRA ENERGY-MATRIZ` |
| L3 | Fornecedor não é lido da planilha (`Codigo`/`Razao Social`) | **Crítica** | PO com `EX000449 · 3PEAK`; planilha indica `EX000135 · HEXING ELECTRICAL CO.,LTD HANGZHOU` |
| L4 | Número da PO (`PC / AE`) não é lido; sem verificação prévia de duplicidade | Alta | Unicidade só por `(importer, normalized_number)` → mesma PO pode existir em duas importadoras sem aviso |
| L5 | Preço real do produto não fica guardado; TOTVS às vezes envia preço 0 por mau uso | Alta | Nenhum registro de preço no catálogo de produtos |
| L6 | `Nro.SC` não é lido | Média | `sc_number` vazio nos 215 itens; SC 020028 não existe no HML |
| L7 | Moeda fixada em `CNY` sem exibição clara nem alternativa por arquivo | Média | 215 itens em CNY |
| L8 | `Valor Total` descartado (sem conferência de total) | Média | Total gravado 4.482.759,54 × total da planilha 4.476.974,09 |
| L9 | Descrição: manual usa o catálogo, upload usa o TOTVS | Média | 214/215 descrições ≠ catálogo |
| L10 | Correção pós-criação inviável em lote (sem reimportar, sem remover item, sem trocar importadora) | Alta | Corrigir 48 preços exige 48 edições individuais |
| L11 | Sem teste automatizado do parser TOTVS | Alta | Nenhum teste em `apps/web/test` cobre `totvs-po-xlsx.ts` |

---

## 2. Como o fluxo funciona hoje

```
Tela "Cadastrar PO do TOTVS" (apps/web/components/NewOperationalRecord.tsx)
 ├─ Cabeçalho manual: SC (opcional), Importadora, Número, Fornecedor, Observações
 ├─ "Dados compartilhados" (necessidade, SC, datas, solicitante, finalidade…)
 ├─ Itens manuais  ─┐
 └─ Upload .xlsx  ──┴─► parseTotvsPoXlsx (apps/web/lib/totvs-po-xlsx.ts)
                         lê: Item, Produto, Descricao, UM, Quantidade, Valor Unitario, CC
                         preenche só os ITENS (cabeçalho fica manual); moeda = CNY fixo
        │
        ▼  POST /api/v1/purchase-orders/complete  (apps/api/src/followup.ts:107)
           transação única: PO + itens + campos operacionais + auditoria/outbox + idempotência
           (fallback legado: POST /purchase-orders + POST /items + PATCH /followup por item)
        │
        ▼  Banco: procurement.purchase_order / purchase_order_item
           trigger purchase_order_supplier_entity_sync (M042) resolve supplier_entry_id
        │
        ▼  Releitura (/followup e /operational) e redirecionamento para /purchase-orders/:id
```

Pontos positivos já existentes (preservar): transação única com idempotência, releitura de
conferência após salvar, rascunho em `sessionStorage`, limite de 500 itens, auditoria e outbox
por operação, validação de formato numérico, vínculo de fornecedor por trigger.

---

## 3. Evidências coletadas

### 3.1 Perfil da planilha `PO 030201.xlsx`

| Aspecto | Resultado |
|---|---|
| Abas / linhas | 1 aba, cabeçalho na linha 1, 215 itens, sem células mescladas |
| Cabeçalho do pedido repetido em toda linha | Empresa, CNPJ (`12.115.480/0001-15`), Fornecedor (`EX000135`, loja `0001`), `PC / AE = 030201` — 1 valor distinto cada |
| `Produto` | 212 numéricos, 3 texto (`GADGET-RF.R120`, `HXAP1000R31044-CEMIG`, `HXWSG100R22014-CEMIG`); sem duplicados |
| `Item` | `0001`…`0215`, sequência contínua |
| `UM` | `UN` em todas; `2a.UM` vazia |
| `Valor Unitario` | arredondado a 2 casas: **200/215** linhas não batem com `Quantidade × Valor Unitario`; 48 linhas com `0` |
| `Valor Total` | preciso e **sem IPI** (`677,30 / 65.000 = 0,01042`); **nenhuma linha com zero** |
| Preço derivado `Valor Total / Quantidade` | Menor preço 0,00103; 32 linhas exigem mais de 8 casas; arredondado a 8 casas reproduz o total de todas as linhas com diferença < 0,005 na moeda da PO |
| `% IPI` | 9 valores distintos (não será usado — D5) |
| `Dt. Entrega` | 2 datas (não será usada — D3) |
| `CC` / `Nro.SC` | 1 valor cada (`1202027` / `020028`) |
| Moeda | **não informada** na planilha |

Execução do parser real (`parseTotvsPoXlsx`) sobre o arquivo: 215 linhas válidas, **48 com
preço 0**, soma `Qtd × Preço` = 4.482.759,54 contra 4.476.974,09 da coluna `Valor Total`.

### 3.2 Estado do banco HML (consulta somente leitura, 2026-10-21)

Conexão conferida: `current_database() = erp_po_totvs_hml`, papel `import_erp_hml_app`,
ledger M001–M064 (64/64). Todas as consultas rodaram em `BEGIN TRANSACTION READ ONLY … ROLLBACK`.

| Verificação | Resultado |
|---|---|
| Produtos da planilha no catálogo global | 215/215 cadastrados e ativos; **0 com NCM** |
| Catálogo de produtos | 1.529 produtos; 0 com NCM; 0 com fabricante; nenhum preço guardado |
| Fornecedor `EX000135` | Existe (`HEXING ELECTRICAL CO.,LTD HANGZHOU`); há 12 fornecedores "HEXING" parecidos |
| Valores operacionais | `UN`, `CC 1202027`, `CNY` e `USD` existem |
| Importadoras | 10; 6 com CNPJ, 4 com nome legado sem CNPJ (`Eletra Cwb`, `Eletra Matriz`, `ELETRA For`, `ELETRA MAO`); CNPJ `…/0003-87` repetido em 2 importadoras (Manaus e Manaus IMP 5) |
| SC `020028` | Não existe (há 1 SC no HML, `23754`) |
| PO `030201` | Criada pelo upload do arquivo; em `Eletra Cwb`, fornecedor `EX000449 · 3PEAK`, 215 itens, CNY, 48 com preço 0, `sc_number` vazio, 1 alocação ativa |
| Auditoria da PO 030201 | 215 `CREATE` de item + **1.290 `FOLLOWUP_UPDATE`** (6 por item: cada edição de campo compartilhado gera 1 registro + 1 outbox por item) |

---

## 4. Lacunas encontradas

As propostas já incorporam as decisões da seção 6.

### A. Dados da planilha não distribuídos (upload)

| ID | Lacuna | Onde | Proposta |
|---|---|---|---|
| A1 | `PC / AE` não preenche o número da PO | `totvs-po-xlsx.ts:16`, `NewOperationalRecord.tsx:469-490` | Ler `PC / AE`; exigir valor único no arquivo; preencher o cabeçalho |
| A2 | `Empresa`/`CNPJ` não definem a importadora | idem | Resolver entre as importadoras **com CNPJ** (D2), mesma regra do upload de invoice (`NewOperationalRecord.tsx:316-326`); seleção manual quando houver mais de uma (caso Manaus) |
| A3 | `Codigo`/`Loja`/`Razao Social` não definem o fornecedor | idem | Resolver por código no catálogo global; alertar quando a razão social divergir do nome cadastrado |
| A4 | `Nro.SC` descartado | idem | Preencher o campo compartilhado `scNumber` (já existe) e sugerir vínculo com a SC cadastrada de mesmo número/importadora |
| A5 | `Valor Total` descartado | idem | Derivar o preço (B1) e conferir o total da PO |
| A6 | `Dt. Entrega`, `% IPI`, `Numero da OP ou CC`, `2a.UM`, `Qtd. 2a UM` | — | Não usar (D3, D5). Sem campo novo, sem aviso |

### B. Integridade de valores

| ID | Lacuna | Onde | Proposta |
|---|---|---|---|
| B1 | Preço arredondado/zero vindo de `Valor Unitario` | `totvs-po-xlsx.ts:141` | Preço = `Valor Total ÷ Quantidade`, arredondado a 8 casas (limite de `numeric(24,8)`); `Valor Unitario` não é usado |
| B2 | Preço 0 do TOTVS (mau uso) | `totvs-po-xlsx.ts`, `operations.ts:62-68` | **Permitido** (D6). Item grava o valor do TOTVS; a prévia e a PO mostram o preço de referência do produto (seção 7) |
| B3 | Moeda fixa `CNY` sem exibição | `NewOperationalRecord.tsx:477, 806` | Moeda do arquivo com padrão `CNY` (D1), visível na prévia e alterável para `USD` antes de aplicar |
| B4 | Sem conferência de total | — | Prévia mostra total da planilha × total calculado; bloquear diferença acima da tolerância |
| B5 | Aritmética em `Number` no front (`calculatedTotal`) | `PurchaseOrderCalculatedFields.tsx` | Aceitável para exibição; a conferência de total usa inteiros/decimal (padrão `decimalUnits` da API) |

### C. Identidade e duplicidade

| ID | Lacuna | Onde | Proposta |
|---|---|---|---|
| C1 | Sem verificação prévia de PO existente | — | Pré-validação: mesmo número na mesma importadora → bloquear; em outra importadora → bloquear, salvo confirmação com justificativa (D7) |
| C2 | Criação lista importadoras legadas sem CNPJ | `NewOperationalRecord.tsx:776`, `/api/v1/importers` | Criação de PO (manual e upload) lista e aceita só importadoras com CNPJ (D2); a API rejeita as demais em novas POs |
| C3 | CNPJ compartilhado por 2 importadoras | `catalog.operational_value` | Upload exige seleção manual entre as correspondências |
| C4 | Importadora não pode ser corrigida após criar | `PATCH /purchase-orders/:id` não aceita `importer` | Troca permitida (D8): Master/Administrador, sem alocações ativas, destino com CNPJ, sem conflito de número no destino |

### D. Propagação catálogo ↔ item

| ID | Lacuna | Onde | Proposta |
|---|---|---|---|
| D1 | Preço real não volta para o produto | — | Preço de referência do produto (seção 7) |
| D2 | Descrição: manual usa o catálogo; upload usa o TOTVS | `NewOperationalRecord.tsx:836-839` × `:473` | Descrição do item = TOTVS (D4). No cadastro manual, o campo fica editável, sugerido pelo nome do catálogo |
| D3 | NCM do produto não é copiado para o item | `followup.ts:150-170` | Preencher `ncm` do item com `product_ncm_code` quando existir (hoje 0 produtos têm NCM) |
| D4 | Item sem vínculo forte com o produto (só `product_code` texto) | M018 | API valida que o código existe no catálogo global ativo; prévia lista os ausentes |
| D5 | `costCenter` e `unit` não são validados | `followup.ts:54-76` | API valida em `COST_CENTER`/`UNIT_OF_MEASURE`; prévia aponta valores novos |

### E. Pós-criação e correção

| ID | Lacuna | Proposta |
|---|---|---|
| E1 | Não há reimportação da planilha numa PO existente | "Atualizar PO pela planilha": casa por `Item` (`external_line_reference`, já único por PO — `M018:29`), mostra diff (preço, quantidade, descrição) e aplica em uma transação |
| E2 | Não há remoção de item | Remover item sem alocação ativa, com motivo, auditoria e outbox |
| E3 | Edição de campo compartilhado gera 1 auditoria + 1 outbox por item | Registrar um evento por PO com a lista de itens (215 → 1); confirmar com consumidores da outbox antes |
| E4 | Item adicionado depois não recebe os campos compartilhados da PO | Herdar campos compartilhados atuais ao adicionar item |

### F. Validação, UX e desempenho

| ID | Lacuna | Proposta |
|---|---|---|
| F1 | Prévia mostra só itens | Prévia em 3 blocos: cabeçalho resolvido, totais e moeda, pendências por linha (incluindo preço 0 com referência) |
| F2 | Erros agregados em texto (8 primeiros) | Tabela de pendências por linha/coluna |
| F3 | 215 cartões de item, cada um com ~15 seletores | Tabela compacta para itens importados; edição detalhada sob demanda |
| F4 | `key={index}` nos itens | Chave estável por item |
| F5 | Rascunho de 215 itens em `sessionStorage` | Medir tamanho; avisar e degradar quando exceder |
| F6 | Upload não registra o arquivo de origem | Nome e SHA-256 do arquivo na auditoria do `CREATE` (como na invoice) |
| F7 | Detecção de planilha procura só 6 cabeçalhos | Validar o layout do export "Pedido de Compras" e informar colunas ausentes |

### G. Testes

| ID | Lacuna | Proposta |
|---|---|---|
| G1 | Parser TOTVS sem teste | `apps/web/test/totvs-po-xlsx.test.mjs` com fixture sintética no layout TOTVS |
| G2 | Sem teste de contrato para as rotas novas | Incluir em `apps/api/test/web-route-contract.test.mjs` |
| G3 | Sem teste das regras novas da API e da migration | Casos em `apps/api/test/` (padrão de `invoice-migrations.test.mjs` para a M065) |

---

## 5. Mapa de distribuição dos dados da planilha

Escopo: somente os campos da PO que têm correspondente na planilha. Os demais campos da PO
não fazem parte deste plano.

### 5.1 Campos da PO com correspondente na planilha

Conferido contra o schema do HML (`procurement.purchase_order` e
`procurement.purchase_order_item`): 13 campos, todos mapeados.

| # | Campo da PO (tabela.coluna) | Coluna da planilha | Hoje | Regra aprovada |
|---|---|---|---|---|
| 1 | `purchase_order.importer` | `CNPJ/CPF` (empresa) | Seleção manual | Importadora com CNPJ igual ao da planilha; seleção manual se houver mais de uma |
| 2 | `purchase_order.external_number` | `PC / AE` | Digitação manual | Valor único no arquivo |
| 3 | `purchase_order.supplier_text` | `Codigo` | Seleção manual | Código do fornecedor no catálogo global |
| 4 | `purchase_order.supplier_entry_id` | `Codigo` (via trigger M042) | Pelo fornecedor escolhido | Resolvido pela trigger a partir do item 3 |
| 5 | `purchase_order.purchase_request_id` | `Nro.SC` | Seleção manual | Sugerir a SC de mesmo número e importadora, se existir |
| 6 | `purchase_order_item.external_line_reference` | `Item` | `Item` | Manter; chave para reimportação |
| 7 | `purchase_order_item.product_code` | `Produto` | `Produto` | Manter; validar no catálogo global |
| 8 | `purchase_order_item.description` | `Descricao` | `Descricao` | Manter; fonte oficial do item (D4) |
| 9 | `purchase_order_item.ordered_quantity` | `Quantidade` | `Quantidade` | Manter |
| 10 | `purchase_order_item.unit` | `UM` | `UM` | Manter; validar em `UNIT_OF_MEASURE` |
| 11 | `purchase_order_item.unit_price` | `Valor Total` ÷ `Quantidade` | `Valor Unitario` (**arredondado**) | Derivado, 8 casas |
| 12 | `purchase_order_item.cost_center` | `CC` | `CC` | Manter; validar em `COST_CENTER` |
| 13 | `purchase_order_item.sc_number` | `Nro.SC` | Não preenchido | Preencher |

`purchase_order_item.currency_code` não tem coluna na planilha: `CNY` padrão, alterável para
`USD` por arquivo (D1).

### 5.2 Colunas da planilha sem campo na PO

| Coluna da planilha | Uso |
|---|---|
| `Empresa`, `Endereco`, `CEP`, `Cidade`, `UF`, `IE` | Conferência da importadora |
| `Razao Social`, `Loja` | Conferência do fornecedor |
| `Valor Unitario` | Não usar (arredondado) |
| `Valor Total` | Deriva o preço (campo 11) e confere o total da PO |
| `Dt. Entrega` | Não usar (D3) |
| `% IPI` | Não usar (D5) |
| Endereço, bairro, CEP, município, estado, CNPJ, IE, fone e fax do fornecedor; `TEL`, `FAX` da empresa | Não usar |
| `2a.UM`, `Qtd. 2a UM`, `Numero da OP ou CC` | Não usar |

### 5.3 Preenchimento automático por vínculo

Campos que se preenchem a partir de uma chave já mapeada em 5.1, usando a entidade
relacionada. Vale para o upload, o cadastro manual e a edição da PO.

Conferido no HML: o catálogo guarda para o produto `code`, `name`, `product_ncm_code` e
fabricante; para o fornecedor, `code` e `name`; para a importadora, `value`, `code`,
`short_name` e `cnpj`. UM, CC e moeda guardam só o valor (sem campo vinculado).

| Chave | Entidade | Campos preenchidos | Hoje | Proposta |
|---|---|---|---|---|
| `CNPJ/CPF` | Importadora (`catalog.operational_value`, `IMPORTER`) | `purchase_order.importer`; nome curto exibido | Upload: nada. Manual: seleção | Upload resolve pelo CNPJ; manual mostra CNPJ e nome curto na lista |
| `Codigo` (fornecedor) | Fornecedor global (`catalog.entry`, `SUPPLIER`) | `supplier_text`, `supplier_entry_id`; nome exibido | Upload: nada. Manual: seleção `código · nome`; trigger M042 resolve a entidade | Upload resolve pelo código; razão social da planilha só confere |
| `Nro.SC` + importadora | SC (`procurement.purchase_request`) | `purchase_request_id`; fornecedor (trigger M040/M042); `sc_number`, `sc_date`, `sc_approval_date`, `requester`, `commercial_plan_received_date` nos itens | Upload: nada. Manual: ao escolher a SC, a tela copia esses campos; a API não confere | Upload sugere a SC; a API passa a copiar os campos da SC no servidor (não só na tela) |
| `Produto` | Produto global (`catalog.entry`, `PRODUCT`) | `description`; `ncm` do item; preço de referência (seção 7) | Upload: nenhuma consulta ao catálogo. Manual: escolha pela descrição preenche código e nome do catálogo (somente leitura); não dá para digitar o código | Digitar ou colar o código preenche descrição, NCM e referência de preço; no upload, a consulta valida o código e traz NCM e referência |
| PO (campos compartilhados) | Itens da mesma PO | Campos compartilhados em todos os itens | Aplicados na criação e na edição; item novo não herda | Item novo herda (E4) |

Regras de precedência:

| Situação | Regra |
|---|---|
| Descrição no upload | Vale a do TOTVS (D4); a do catálogo aparece só como referência |
| Descrição no manual | Preenchida pelo código e editável; origem conforme D9 |
| SC vinculada com fornecedor diferente do `Codigo` da planilha | **Bloquear** com aviso. Hoje a trigger troca o fornecedor pelo da SC sem avisar |
| SC de outra importadora que não a do CNPJ | Bloquear; a SC precisa ser da mesma importadora |
| NCM do produto vazio | Item fica sem NCM; sem bloqueio (hoje 0 produtos têm NCM) |
| Usuário altera o código do produto | Descrição, NCM e referência são preenchidos de novo |
| Descrição do TOTVS muito diferente da do catálogo | Apenas sinalizar na prévia (ex.: `2010100130` — catálogo "1.5K 1/8W", TOTVS "330K 1/4W"); a correção do catálogo é feita no cadastro de produtos |

---

## 6. Decisões de negócio

Respondidas em 2026-10-21.

| ID | Pergunta | Decisão | Efeito no plano |
|---|---|---|---|
| D1 | Moeda do export TOTVS | **CNY**; algumas POs são em USD, mas o foco é CNY | Padrão `CNY`, alteração para `USD` por arquivo na prévia |
| D2 | Importadoras legadas sem CNPJ | **Foco nas importadoras com CNPJ** | Criação de PO só com importadoras com CNPJ; legadas continuam legíveis; consolidação fora do escopo |
| D3 | `Dt. Entrega` do TOTVS | **Não usar** | Sem campo novo |
| D4 | Descrição oficial do item | **TOTVS** (é onde estão os registros) | Item grava a descrição do TOTVS; catálogo só como referência |
| D5 | Guardar `% IPI` | **Não** | Sem campo novo |
| D6 | Item com preço 0 | **Permitido** (mau uso no TOTVS). O preço real informado numa PO deve ir para a entidade Produto e ficar guardado | Seção 7 — preço de referência do produto |
| D7 | Mesmo número de PO em importadoras diferentes | **Não, a priori**; pode ocorrer em casos bem específicos | Bloqueado por padrão; permitido com confirmação e justificativa auditada |
| D8 | Trocar importadora após a criação | **Sim** | Master/Administrador, sem alocações ativas, destino com CNPJ |
| — | PO 030201 do HML | **Manter como dado de teste** (criada pelo upload do arquivo) | Seção 10 |
| D9 | No cadastro manual, o código do produto preenche qual descrição? (O nome do catálogo é a descrição fiscal longa, não a do TOTVS) | **Guardar no produto a última descrição TOTVS vista numa PO e usá-la para preencher o item; sem ela, usar o nome do catálogo** | Seções 5.3 e 7.3 |

---

## 7. Preço de referência do produto

Atende D6: o TOTVS pode mandar preço 0, mas sempre que um preço real (> 0) for informado numa
PO, ele fica guardado no produto e passa a ser a referência.

### 7.1 Regra

| Situação | Comportamento |
|---|---|
| Item salvo com preço > 0 e moeda | Registra observação de preço para o produto (por moeda) e atualiza a referência atual |
| Item salvo com preço 0 | Grava 0 no item (fiel ao TOTVS); **não** altera a referência do produto |
| Item com preço 0 e produto com referência na mesma moeda | Prévia, PO e acompanhamento exibem "Preço de referência: X CNY (PO nnn, data)" e um **valor estimado** do item; o preço do item não é sobrescrito |
| Item com preço 0 e produto sem referência | Pendência visível na prévia ("sem preço real conhecido"); salvar continua permitido |
| Preço do item corrigido depois (edição, reimportação ou atualização pela invoice) | Nova observação; a referência passa a ser a mais recente |
| Moedas diferentes (CNY × USD) | Referências separadas por moeda; sem conversão |

### 7.2 Desenho técnico (M065, somente HML)

- Tabela `catalog.product_price_observation`: produto (`catalog.entry`, `PRODUCT` global),
  moeda, preço unitário `numeric(24,8) > 0`, item e PO de origem, número da PO, data da
  observação, ator. Índice por `(produto, moeda, data desc)`.
- Referência atual = observação mais recente por produto e moeda (view ou consulta indexada).
- Registro por **trigger** em `procurement.purchase_order_item` (`AFTER INSERT OR UPDATE OF
  unit_price, currency_code`): cobre criação, edição, reimportação e a atualização de preço feita
  pelo upload da invoice, sem depender de cada rota. Só grava quando o preço for > 0 e o código
  existir no catálogo global.
- API: referência incluída em `/products/options`, no detalhe da PO (`/operational`,
  `/followup`) e na pré-validação do upload; histórico consultável no catálogo de produtos.
- Carga inicial: **não** usar preços já gravados no HML. As POs existentes têm preços
  arredondados (PO 030201) ou de teste; a referência começa vazia e nasce das próximas POs.

### 7.3 Descrição TOTVS do produto (D9)

- A mesma trigger guarda, por produto, a última descrição TOTVS informada num item de PO
  (com a PO de origem e a data). Descrição vazia não altera o valor guardado.
- O nome do catálogo (descrição fiscal) não é alterado.
- No preenchimento por código (seção 5.3), o item recebe a descrição TOTVS guardada; sem ela,
  recebe o nome do catálogo. O campo continua editável.
- Carga inicial vazia, pelo mesmo motivo da referência de preço.

### 7.4 Fora desta regra

- Não muda a comparação de preço da invoice. Com o item em 0, a invoice continua sinalizando
  divergência; usar a referência nessa comparação é um próximo passo, com decisão própria.

---

## 8. Especificação

```markdown
# Tarefa: Criação de PO completa e confiável (manual e upload TOTVS)

## Objetivo
Fazer o upload do export TOTVS preencher a PO (cabeçalho e itens) com valores corretos e
conferidos, guardar no produto o preço real informado nas POs e alinhar o cadastro manual às
mesmas validações.

## Requisitos
- R1  Preço unitário = Valor Total ÷ Quantidade (8 casas); Valor Unitario não é usado.
- R2  Importadora resolvida pelo CNPJ entre importadoras com CNPJ; seleção manual se ambígua.
- R3  Criação de PO (manual e upload) aceita somente importadoras com CNPJ.
- R4  Fornecedor resolvido por Codigo no catálogo global; alerta se a razão social divergir.
- R5  Número da PO lido de PC / AE (valor único no arquivo).
- R6  Pré-validação de PO existente: mesma importadora bloqueia; outra importadora exige
      confirmação com justificativa, registrada na auditoria.
- R7  Nro.SC preenche scNumber e sugere vínculo com SC existente.
- R8  Moeda do arquivo CNY por padrão, alterável para USD na prévia.
- R9  Descrição do item = TOTVS; no manual, editável e sugerida pelo catálogo.
- R10 Preço 0 permitido; preço > 0 gera observação no produto (seção 7); preço 0 exibe a
      referência e o valor estimado, sem sobrescrever o item.
- R11 Prévia com cabeçalho resolvido, totais (planilha × calculado) e pendências por linha.
- R12 API valida produto no catálogo global e UM/CC em valores operacionais.
- R13 Arquivo de origem (nome + SHA-256) na auditoria da criação.
- R14 Reimportação da planilha numa PO existente, com diff por Item e aplicação transacional.
- R15 Remoção de item sem alocação ativa, com motivo, auditoria e outbox.
- R16 Troca de importadora: Master/Administrador, sem alocações ativas, destino com CNPJ.
- R17 Preenchimento por vínculo (seção 5.3): código do produto preenche descrição, NCM e
      referência de preço; código do fornecedor resolve a entidade; CNPJ resolve a importadora.
- R18 SC vinculada: a API copia os campos da SC para os itens e bloqueia SC com fornecedor ou
      importadora diferentes dos da planilha.

## Restrições
- Manter POST /purchase-orders/complete (transação única + idempotência + releitura).
- Manter compatibilidade com API sem as rotas novas (padrão isMissingApiRoute).
- Toda escrita com auditoria e outbox; versionamento por X-Record-Version.
- Migrations novas aplicadas e testadas só no HML; produção apenas após aprovação.
- Testes sem dados de negócio reais: fixtures sintéticas no layout TOTVS.
- Não alterar variáveis da Vercel nem configuração da VPS além da troca de build.

## Critérios de aceite
- CA1 Upload de PO 030201.xlsx gera 215 itens, nenhum com preço 0, e soma Qtd × Preço igual
      ao Valor Total da planilha (tolerância de 0,01 por linha, na moeda da PO).
- CA2 Upload preenche ELETRA ENERGY-MATRIZ, fornecedor EX000135, número 030201, moeda CNY e
      scNumber 020028.
- CA3 Importadoras sem CNPJ não aparecem na criação e a API recusa nova PO para elas.
- CA4 Número já existente na mesma importadora bloqueia; em outra importadora só salva com
      confirmação e justificativa, que aparecem na auditoria.
- CA5 Item com preço > 0 gera observação no produto; item com preço 0 é salvo, não altera a
      referência e exibe referência e valor estimado quando houver.
- CA6 Arquivo com CNPJ ambíguo sem seleção, ou produto fora do catálogo, não salva.
- CA7 API rejeita item com UM/CC inexistente (400).
- CA8 Reimportar o mesmo arquivo numa PO existente mostra diff vazio; alterar um preço no
      arquivo mostra exatamente essa diferença e aplica em uma transação auditada.
- CA9 Troca de importadora funciona para Master/Administrador sem alocações; demais casos 403/409.
- CA10 Testes do parser, da API, da migration e de contrato web↔API passam; lint, type-check e
       build passam.
- CA11 No cadastro manual e na edição da PO, digitar o código de um produto do catálogo
       preenche descrição (origem conforme D9), NCM (quando houver) e referência de preço.
- CA12 PO com SC vinculada recebe nos itens os campos da SC gravados pela API; SC com
       fornecedor diferente do `Codigo` da planilha é bloqueada com aviso.

## Fora do escopo
- Consolidar importadoras legadas e migrar POs entre elas.
- Dt. Entrega, % IPI e demais colunas marcadas como "Não usar" na seção 5.
- Usar a referência de preço na comparação da invoice.
- Conversão entre moedas.
- Popular NCM/fabricante do catálogo de produtos.
- Integração direta com o TOTVS (API/ODBC).
- Qualquer escrita no banco de produção.

## Plano
Ver seção 9 (ciclos 1 a 4).
```

---

## 9. Ciclos de entrega

Cada ciclo segue o fluxo do AGENTS.md: testes primeiro, commits pequenos na `homologacao`,
verificação completa (testes, lint, type-check, build), deploy da API na VPS HML quando houver
mudança de API, Preview `Ready` e validação no domínio estável antes de seguir.

### Ciclo 1 — Upload correto (somente web)

Corrige o que gera dado errado hoje, sem migration.

- [x] `apps/web/test/totvs-po-xlsx.test.mjs`: fixture sintética no layout TOTVS cobrindo preço
      arredondado, `Valor Unitario` 0 com total > 0, total 0, total com mais de 8 casas, código
      numérico × texto, linhas vazias, cabeçalho ausente, `PC / AE` com mais de um valor.
- [x] `totvs-po-xlsx.ts`: derivar preço de `Valor Total`; devolver cabeçalho (`PC / AE`, CNPJ,
      fornecedor, `Nro.SC`) e totais além das linhas.
- [x] `NewOperationalRecord.tsx`: preencher número, importadora (CNPJ, só importadoras com
      CNPJ), fornecedor e `scNumber`; moeda CNY padrão com troca para USD; prévia com totais e
      pendências; descrição TOTVS; descrição editável no cadastro manual.
- [x] Preenchimento por vínculo na tela (seção 5.3): campo de código do produto digitável no
      cadastro manual e na edição da PO, preenchendo descrição e NCM a partir do catálogo;
      aviso de divergência entre descrição TOTVS e catálogo na prévia.
- [x] Ajuste de interop do `exceljs` para permitir o teste em Node, sem mudar o comportamento no
      bundler (no Node, `import("exceljs")` não expõe `Workbook` como export nomeado).
- **Aceite:** CA1, CA2, CA6 (lado web).

### Ciclo 2 — Pré-validação e regras na API

- [x] Rota de pré-validação (`POST /api/v1/purchase-orders/preflight`): PO existente na
      importadora e nas demais do escopo, fornecedor e produtos fora do catálogo.
- [x] `/complete` e rotas de item: importadora com CNPJ, confirmação + justificativa para número
      existente em outra importadora, produto no catálogo global, UM e CC válidos, nome/SHA-256
      do arquivo na auditoria.
- [x] `/api/v1/importers`: informar quais importadoras aceitam novas POs.
- [x] SC vinculada: a API copia `sc_number`, `sc_date`, `sc_approval_date`, `requester` e
      `commercial_plan_received_date` da SC para os itens; bloqueia SC com fornecedor diferente
      do informado ou de outra importadora (R18).
- [x] Item criado com NCM do produto quando o catálogo tiver `product_ncm_code`.
- [x] Testes de API e de contrato web↔API; build e deploy da API na VPS HML.
- [x] Validação autenticada no HML: duplicidade na mesma importadora e em outra importadora;
      importadora apta, fornecedor, produto, UM e CC; valores ausentes; recusas de importadora sem
      CNPJ e de UM/CC inválidos; criação completa de PO sintética. A PO 030201 permaneceu inalterada.
- **Aceite:** CA3, CA4, CA6 (lado API), CA7.

### Ciclo 3 — Preço de referência do produto (migration no HML)

- [x] Migration M065 (somente HML): `catalog.product_price_observation`, índice e trigger em
      `purchase_order_item` (seção 7.2). Backup verificável, teste em cópia descartável,
      aplicação, ledger 65/65, conferência de que nenhuma observação foi criada a partir dos
      dados existentes.
- [x] API: referência atual em `/products/options`, `/purchase-orders/:id/operational`,
      `/followup` e na pré-validação; histórico no catálogo de produtos.
- [x] Web: referência e valor estimado na prévia, no item da PO e no catálogo de produtos.
- [x] Guardar a última descrição TOTVS por produto (mesma trigger, seção 7.3) e usá-la no
      preenchimento por código (D9).
- [x] Testes: trigger (preço > 0 grava, 0 não grava, moeda separada, produto fora do catálogo
      ignorado), migration, API e contrato.
- **Aceite:** CA5.

### Ciclo 4 — Correção pós-criação

- [x] Reimportação por planilha com diff por `Item` e aplicação transacional (R14), coberta por testes.
- [x] Remoção de item sem alocação ativa (R15), coberta por testes.
- [x] Troca de importadora (R16), validando SC vinculada (a SC é da importadora) e número no destino,
      coberta por testes.
- [x] Item novo herda campos compartilhados (E4), coberto por testes.
- [x] Validação autenticada no HML: reimportação idêntica com diff vazio; alteração de quantidade
      com uma diferença e aplicação; remoção do item; troca de importadora por Master sem alocação
      ativa. Os cenários usaram somente uma PO sintética, excluída logicamente ao final.
- [ ] Avaliar com os consumidores da outbox a consolidação de `FOLLOWUP_UPDATE` por PO (E3);
      implementar só com aprovação.
- **Aceite:** CA8, CA9.

### Melhorias de UX/desempenho (encaixar no ciclo que tocar o componente)

- [x] Tabela compacta para itens importados (F3) e chave estável por item (F4).
- [x] Pendências por linha (F2) e controle de tamanho do rascunho (F5), com aviso visível também
      para POs manuais e fallback para rascunho compacto; coberto por testes de armazenamento.

---

## 10. PO 030201 do HML como dado de teste

A PO 030201 do HML foi criada pelo upload de `PO 030201.xlsx` com o código atual. Ela fica como
está e serve de caso de regressão:

Na validação autenticada do HML, a PO 030201 não foi alterada: importadora, número, versão,
ciclo de vida, fornecedor, 215 itens e alocações ativas permaneceram iguais. Para validar as rotas,
foi criada somente a PO sintética `HMLVALMVIIAQ73B9DD951D-CREATE` com um item. A reimportação
alterou a quantidade de 1 para 2; o item foi removido e a importadora foi trocada por uma segunda
importadora com CNPJ. A PO de teste ficou excluída logicamente, com item `CANCELLED`, sete eventos
de auditoria e sete mensagens de outbox. A observação temporária de descrição foi removida e o preço
zero não criou observação de preço. As contagens passaram de 2 POs e 215 itens para 3 POs e 216
itens (incluindo a PO excluída logicamente), sem mudança nas alocações ativas. A senha temporária
de validação não foi persistida; hash e metadados originais da credencial foram restaurados e a
sessão de teste foi revogada.

A validação da interface no Preview permanece pendente: o check Vercel do commit `6a18999` está
`success`, mas o domínio estável responde HTTP 302 para `vercel.com/sso-api`.

| Uso | Resultado esperado |
|---|---|
| Comparar com o novo upload do mesmo arquivo | Preços, importadora e fornecedor do novo upload corrigem as diferenças da seção 3.2 |
| Subir o mesmo arquivo após o Ciclo 2 | Número 030201 já existe em `Eletra Cwb` → upload em `ELETRA ENERGY-MATRIZ` exige confirmação e justificativa (D7) |
| Ciclo 3 | Seus preços **não** alimentam a referência de produto (carga inicial vazia) |
| Ciclo 4 | Caso real para reimportação (diff de 200 preços), troca de importadora (bloqueada enquanto houver a alocação ativa) e remoção de item |

Qualquer gravação de teste é feita somente no HML, com conferência prévia do banco, dados de
teste identificados e limpeza controlada; produção não é tocada.

---

## 11. Arquivos afetados

| Arquivo | Ciclo | Alteração |
|---|---|---|
| `apps/web/lib/totvs-po-xlsx.ts` | 1 | Preço derivado, cabeçalho e totais |
| `apps/web/components/NewOperationalRecord.tsx` | 1–3 | Cabeçalho pelo arquivo, moeda, prévia, pré-validação, referência de preço |
| `apps/web/test/totvs-po-xlsx.test.mjs` (novo) | 1 | Testes do parser |
| `apps/web/test/fixtures/` | 1 | Planilha sintética no layout TOTVS |
| `apps/api/src/followup.ts` | 2, 3 | Validações, auditoria do arquivo, referência de preço |
| `apps/api/src/operations.ts` | 2, 4 | Validações de item, remoção de item, troca de importadora |
| `apps/api/src/purchase-orders.ts` | 2 | Pré-validação de PO existente |
| `apps/api/src/catalog.ts` | 2, 3 | Importadoras aptas; referência de preço em produtos |
| `apps/api/migrations/M065_*.sql` (novo) | 3 | Observações de preço por produto e trigger |
| `apps/web/components/OperationalPoPanel.tsx` | 3, 4 | Referência de preço, reimportação, remoção, troca de importadora |
| `apps/web/app/catalog/` | 3 | Histórico de preço do produto |
| `apps/api/test/*.test.mjs` | 2–4 | API, migration e contrato web↔API |
| `deploy/hostinger/README.md` | 2–4 | Registro dos deploys e da M065 no HML |

---

## 12. Riscos e cuidados

| Risco | Mitigação |
|---|---|
| Preço derivado com dízima (32 linhas da PO 030201) | Arredondar a 8 casas; validar que `Qtd × Preço` reproduz o total da linha |
| Referência de preço contaminada por preço errado | Carga inicial vazia; só preço > 0; histórico preservado para auditoria; correções geram nova observação |
| Moeda errada gravada em massa | Moeda visível e confirmada na prévia; referência separada por moeda |
| Importadoras legadas ainda usadas em POs antigas | Bloqueio só na criação; leitura, edição e IPs existentes continuam funcionando |
| Itens com preço 0 continuam gerando divergência na invoice | Fora do escopo; referência exibida para apoiar a análise manual |
| Bloquear UM/CC inexistente quebra fluxos atuais | Introduzir primeiro como aviso na prévia; bloqueio na API após conferir os valores no HML |
| Dados de negócio em testes | Fixtures sintéticas; testes de banco só no HML com dados de teste e limpeza |
| API HML desatualizada em relação ao Preview | Validar a versão instalada na VPS e a rota alterada após cada deploy (AGENTS.md) |
