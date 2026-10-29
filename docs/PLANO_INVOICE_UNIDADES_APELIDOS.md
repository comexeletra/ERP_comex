# Plano de implementação — Unidades equivalentes e apelidos de Exporter na carga da INV

| Item | Valor |
|---|---|
| Data | 2026-10-29 |
| Branch de trabalho | `homologacao` |
| Ambiente de validação | HML (VPS `import-erp-hml-api` + banco `erp_po_totvs_hml`) e Preview Vercel |
| Status | **Implementado e publicado em HML/Preview; teste de tela da IPH034A pendente** |

## 1. Resumo

| | Problema | Solução |
|---|---|---|
| 1 | A invoice usa `PCS` e a PO usa `UN` ou `PC`: a carga pede confirmação de unidade em quase toda linha (196 na IPH034A) | Grupos de unidades equivalentes, válidos para todos os fornecedores e produtos |
| 2 | O Exporter da invoice traz nome e endereço (`HEXING ELECTRICAL CO.,LTD SHANGCHENG…`) e não bate com o fornecedor da PO (`EX000135 HEXING ELECTRICAL CO.,LTD HANGZHOU`): aviso em toda linha e IP sem fornecedor do cadastro | Apelidos de Exporter por fornecedor (nomes curtos), reconhecidos quando o Exporter começa com o apelido |

## 2. Diagnóstico (2026-10-29, somente leitura no HML)

- IPH034A (`IPH034A 2026       INV+PL.xlsx`): 196 linhas, todas `PCS`, todas da PO 030201; Exporter em várias linhas, a primeira é `HEXING ELECTRICAL CO.,LTD`.
- `erp_po_totvs_hml` em M073. Unidades dos itens de PO: `UN` 490, `PC` 17.
- PO 030201 ativa (ELETRA INDUSTRIA…, fornecedor EX000135): 215 itens em `UN`, preços em CNY iguais aos da invoice, sem divergência de código. Está toda alocada nos 7 IPs da simulação `030201-A/2026`…`G/2026` (225 alocações), e o produto 2054300540 da invoice não existe nela.
- 12 fornecedores com "HEXING" no cadastro; EX000767 e EX000495 se chamam exatamente "HEXING ELECTRICAL CO.,LTD". Por isso o apelido só é comparado com o fornecedor da PO escolhida, nunca procurado no cadastro inteiro.
- `catalog.entry_alias` guarda o histórico de código do fornecedor (Protheus) e não serve para o Exporter.

## 3. Especificação

### Objetivo
Deixar de pedir confirmação linha a linha quando a diferença é só de grafia (unidade ou Exporter com endereço), para a IPH034A chegar à revisão sem pontos de unidade nem de fornecedor.

### Requisitos
1. **Unidades equivalentes (todos os fornecedores e produtos).** Depois de normalizar (maiúsculas, sem acento, ponto e espaço), são equivalentes as unidades do mesmo grupo: peça `UN, UND, UNID, UNIDADE, PC, PCS, PÇ, PCE, PECA, UNIT, UNITS, EA`; quilo `KG, KGS`; metro `M, MT, MTS`. Mesmo grupo não pede confirmação; grupos diferentes ou unidades fora da lista continuam pedindo. A comparação continua mostrando os dois valores. A regra fica na API (`apps/api/src/unit-equivalence.ts`) e na web (`apps/web/lib/china-invoice-mapping.ts`), com teste que garante listas iguais.
2. **Apelidos de Exporter (M074).** Tabela `catalog.supplier_exporter_alias` ligada a um fornecedor global (`kind = 'SUPPLIER'`, `importer IS NULL`). O apelido é guardado como digitado e normalizado (só letras e números, maiúsculas), com pelo menos 8 caracteres normalizados, sem repetir no mesmo fornecedor enquanto ativo. Remover é lógico (`status = 'REMOVED'`, com autor, data e motivo). Cadastrar e remover gravam auditoria e outbox.
3. **Correspondência.** O Exporter corresponde ao fornecedor da PO quando bate como hoje (código, nome ou texto, normalizados) ou quando o Exporter normalizado começa com um apelido ativo desse fornecedor.
4. **Gravação do IP.** Com correspondência em todas as linhas, o IP recebe o fornecedor do cadastro e `invoice_supplier_divergence = false`; o Exporter completo continua nos metadados da invoice. A API recalcula a correspondência com os apelidos do banco e não confia na tela.
5. **Rotas.** `GET /api/v1/suppliers/:id/exporter-aliases` (`catalog.read`), `POST /api/v1/suppliers/:id/exporter-aliases` (`catalog.write`, chave de idempotência) e `POST /api/v1/suppliers/:id/exporter-aliases/:aliasId/remove` (`catalog.write`, motivo). Escrita restrita aos perfis que já editam fornecedores (Master, Administrador, Compras). A rota de candidatos em lote devolve `supplierExporterAliases` em cada item.
6. **Telas.** No cadastro de fornecedores (`/catalog/values`, campo Fornecedor), cada fornecedor mostra os apelidos e permite cadastrar e remover. Na revisão da invoice, com divergência de fornecedor e permissão de escrita, o botão "Cadastrar como apelido" sugere a primeira linha do Exporter e revalida as linhas depois de cadastrar. Textos nos três dicionários.

### Restrições
- As regras do banco de M061/M062 não mudam: a correspondência por apelido entra pelo caminho normal, com o mesmo fornecedor na PO e no IP.
- A rota GET antiga `invoice-candidates` não muda.
- M074 roda só no HML, com backup; na produção, só na promoção aprovada.

### Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | `PCS`×`UN` e `KGS`×`KG` não pedem confirmação; `PCS`×`KG` pede | `apps/api/test/unit-equivalence.test.mjs`, `apps/web/test/invoice-audit-points.test.mjs` |
| 2 | Listas de unidades iguais na API e na web | `apps/api/test/unit-equivalence.test.mjs` |
| 3 | Apelido do fornecedor da PO reconhece o Exporter com endereço; o mesmo apelido em outro fornecedor não | `apps/api/test/operations.test.mjs`, `apps/web/test/invoice-audit-points.test.mjs` |
| 4 | Apelido curto, repetido ou de algo que não é fornecedor é recusado; escrita sem permissão responde 403 | `apps/api/test/supplier-aliases.test.mjs` |
| 5 | Com correspondência, o IP grava o fornecedor do cadastro e não marca divergência | `apps/api/test/operations.test.mjs` |
| 6 | Rotas registradas para a web; textos nos três idiomas | `web-route-contract.test.mjs`, `i18n` |
| 7 | IPH034A carrega no Preview sem pontos de unidade ou fornecedor a confirmar | validação manual no HML |

### Fora do escopo
Confirmação em lote, limite de chamadas por usuário, remoção da rota GET antiga e promoção para `main`.

## 4. Etapas

| Etapa | Conteúdo |
|---|---|
| 1 | Unidades equivalentes: testes e regra na API e na web |
| 2 | M074, rotas de apelido e seus testes |
| 3 | Correspondência por apelido na carga da invoice e na rota de candidatos |
| 4 | Telas e textos |
| 5 | Verificação completa e revisão do diff |
| 6 | Backup e M074 no HML, release da API na VPS, push e Preview |
| 7 | Dados de aceite no HML e carga da IPH034A |

## 5. Dados de aceite no HML

Decisão do usuário (2026-10-29): criar uma PO de teste só para a IPH034A, sem mexer na simulação dos IPs `030201-A`…`G`. Como a célula PO da invoice traz `PO030201` e a carga exige o mesmo número, a PO de teste usa o número 030201 numa importadora diferente da PO da simulação, com os 196 produtos da invoice (inclusive 2054300540) e fornecedor EX000135. A carga então pede a confirmação de CNPJ da importadora, que fica registrada na auditoria. Ao final, a invoice e as alocações de teste são canceladas e o IP e a PO de teste ficam `DELETED`.

## 6. Resultado da execução

- Commits: plano `4c28ba4`; unidades `5bc6105`; M074 e rotas `6135752`; correspondência `a97ea01`; telas `32ad8e3`; dados de aceite `a1efd37`.
- HML: backup, ensaio com ROLLBACK e M074 aplicada (ledger 74); release `hml-release-32ad8e3` ativo, com o worker no mesmo release. Detalhes em `deploy/hostinger/README.md`.
- Preview `dpl_BdaLezq47JsVQJ7f1Ntun3yDoRyK` em `Ready`, branch `homologacao`, commit `32ad8e3`.
- Aceite pela API do release com as funções da tela: na IPH034A, 0 pontos de unidade (antes 196) e 0 de fornecedor com o apelido (196 sem ele); nenhum problema de destino nem de código.
- Pendente: o teste de tela no Preview (cadastrar o apelido pelo botão e revisar as linhas), que precisa de uma sessão de usuário.
- Achados fora do escopo: (1) a IPH034A ainda pede 135 confirmações de preço, porque os preços da invoice diferem dos da PO 030201 (106 acima de 0,01%; alguns casos são só arredondamento do preço calculado pela planilha); (2) o parser lê o número da invoice como `INVOICE`, porque o título da planilha bate com o rótulo `INVOICE:`; o número real é `PWBR260205-10A`.
