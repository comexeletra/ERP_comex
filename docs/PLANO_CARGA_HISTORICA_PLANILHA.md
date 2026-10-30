# Tarefa: carga histórica da planilha Follow Up (Pré e Pós Embarque)

Status: **carregada no HML em 2026-10-30, aguardando validação do usuário no Preview**. Pendência externa: o arquivo
`Status PO's`, que o usuário enviará para associar o T0 às SCs. Produção não foi alterada.

Arquivo: `Follow Up Import 2026 - atualizado .xlsx`, SHA-256
`a913434489b8ba9af81803bcd0661b4cc7aa212206a3d0fbb6d1dbacd3e315bc`, confirmado pelo usuário como a versão a carregar.
Banco: `erp_po_totvs_hml`.

## Objetivo

Levar para o sistema todo o histórico das abas Pré Embarque e Pós Embarque, numa carga definitiva no corte, primeiro no
HML. O sistema deixa de depender da planilha e o End to End passa a ser calculado só com os dados cadastrados.

## Decisões

### Identidade

| Tema | Decisão |
|---|---|
| Importadoras | `ELETRA MATRIZ` → `ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L` (01); `ELETRA CWB` → `ELETRA CURITIBA` (02); `ELETRA FOR` → `ELETRA INDUSTRIA E COMERCIO( GALPAO-FORTALEZA )` (03) |
| Número da PO | Completa com zeros à esquerda até 6 dígitos (`30201` → `030201`, `1721` → `001721`); `531195` fica igual |
| Número da SC | Mesma regra. Célula com mais de uma SC (`14723\n14746`, `12581/12610`) é separada; `NO SC` fica vazio |
| Tipo de carga | Uma carga definitiva no corte |
| Simulação do HML | Apagar POs, itens, IPs, alocações, documentos e SCs de teste, com backup antes; manter os cadastros |

### Fornecedor

| Tema | Decisão |
|---|---|
| Regra geral | Histórico usa o cadastro sem código EX (`HEXING`, `ZLINK`...) |
| PO 18223 | HEXING; a linha ZLINK está cancelada |
| PO 18751 | ZLINK; a linha HEXING entregue em `003C/2026` fica sem alocação, na Qualidade |
| POs 31287, 30668 e 31335 | Sem fornecedor, na Qualidade |
| PO 32005 | Não fica de fora: recebe o fornecedor do IP `D-FLOW01/2026` e é alocada. Os dados entram aos poucos no sistema |
| INFOVISTA e D-FLOW | Criar cadastros sem código EX |

### Dados

| Tema | Decisão |
|---|---|
| Colunas | Pré `B:BA`; Pós `B:AN`. Fines, Storage e Demurrage ficam fora: virão da futura base de despesas |
| Aba End-to-End | Não usar; o End to End deriva dos dados do sistema |
| T0 | Virá do arquivo `Status PO's`, associado pela SC |
| T3 real | A data do BL é a saída real; o ETD é só estimativa |
| ETA e ETE | Só os digitados entram como confirmados (59 e 12); os demais o sistema calcula. Regra validada: 161 de 161 ETA e 208 de 208 ETE em fórmula batem com o cálculo |
| Doc ok | Passa a ser um campo de data (`documents_ok_date`); a coluna antiga fica só para linhas anteriores |
| Quantidade de contêiner | Decimal: um contêiner dividido entre dois IPs conta `0,5` em cada um (48 IPs) |
| Moeda sem preço | A moeda não entra no item, que exige os dois; o valor original fica na linha de origem |
| Preço sem moeda (78 linhas) | O preço original é mantido no item e a moeda fica vazia, inclusive na linha com `US$` |
| Tipo de demanda | Coluna `G` igual a `MTS` grava `MTS` na PO; qualquer outro valor, inclusive vazio, grava `Não MTS` |
| Analyst | Nova entidade de seletor; campo opcional na PO |
| SI | Campo de texto opcional na PO, sem entidade. Valores distintos da PO são unidos por vírgula |
| Linhas sem PO (86) | Ficam na origem e na Qualidade |
| Linhas canceladas | Coluna IP com `Cancelled` ou status `CANCELLED`: item cancelado, sem alocação |
| POs encerradas | 37 canceladas entram `CANCELLED`, 218 terminadas entram `CLOSED`, 111 ficam `ACTIVE`; IPs entregues ficam abertos |
| PO e SC | Todas as SCs são criadas. A PO aponta para a SC quando tem uma só, com o mesmo fornecedor; nos demais casos a SC fica em cada produto. SC com 2 fornecedores fica sem fornecedor |
| SC sem solicitante (21) | Entra sem solicitante; o campo passa a aceitar vazio no banco |

### Seletores

Paridade significa valor igual ao ignorar maiúsculas, acentos, espaços e pontuação; nesses casos fica o valor do cadastro.

| Campo | Regra |
|---|---|
| Priority | `P` e `p` → `Prioridade`; vazio continua vazio |
| Category | `Water` → `WATER METER`; `BESS Production`, `MAO` e `Software` são novos; `0` e `#N/A` ficam vazios |
| Cost Center | Incluir 7 códigos: `3201015`, `1102001`, `1202023`, `2201006`, `3201011`, `1101001`, `2201003` |
| Demand | Incluir `MRP`, `New Energy` e `AP`; `SAMPLES` → `Sample`; `MTS` não entra, pois é tipo de demanda |
| Requester | `JESSICA - PCM` → `PCM - JESSICA`; `R&D` → `R&D -`; `R&D - BRENO` → `R&D - BRENO CHAVES`; 9 novos |
| Purpose e Group | Incluir `Software` |
| Broker | Paridade (`Ágil` → `ÁGIL`); `PORTO PRIME` é novo; `0` fica vazio |
| Forwarder | Paridade (`Savino Del Bene` → `SAVINO DEL BENE`, `Allog` → `ALLOG`, `DC Logistics` → `DC LOGISTICS`) |
| Incoterm | `0` fica vazio |
| Portos | `NBG` → `NGB`; `SUECIA` é novo; `0` fica vazio |
| Container Type | Paridade (`40 HQ` → `40'HQ`, `40 NOR` → `40' NOR`, `20 GP` → `20'GP`); `40 GP` é novo como `40'GP` |
| Mode | Maiúsculas (`Sea` → `SEA`) |

## Requisitos

1. Preservar cada linha de `B:BA` e `B:AN` em `migration.source_row`. `file_values` guarda as células como estão no arquivo,
   com as letras dele. `raw_values` guarda os valores normalizados nas chaves que as telas leem (layout aprovado em 2026, mais
   `BC` = SI, `BD` = Analyst e `BE` = Group). O `.xlsx` não é alterado.
2. Criar SCs, POs, itens, IPs, alocações e documentos. PO e IP nascem com `source_kind` histórico; item com
   `IMPORTED_SOURCE_ITEM`.
3. Cada linha do Pré com PO vira um item, como na M026. As 531 combinações PO + código repetidas continuam separadas e o
   saldo fica correto porque cada item recebe a sua alocação.
4. Campo do IP: o Pós prevalece sobre o Pré. Os 4 IPs fora do Pós (`039/2026`, `020/2025`, `017/2026`, `INF-004/2025`) usam
   o Pré.
5. `calculateE2e`: T3 real é `actual_port_departure_date` ou, na falta dela, `bl_date`; o ETD não conta mais como data real.
6. Campos que na planilha são fórmula derivada não entram como dado digitado: Alert, Status, Total Price, LT Total, Transit
   Time e Due Storage.
7. Texto em campo de data vira vazio, com registro na Qualidade.
8. A carga registra auditoria e pendências de Qualidade, roda numa transação única e recusa repetir o mesmo hash com a mesma
   versão de mapeamento.

## Restrições

- Somente em `erp_po_totvs_hml`; o carregador recusa outro banco. Produção só depois de aprovação e de um plano próprio,
  porque lá já existe o lote antigo.
- Backup verificado antes de apagar a simulação e de aplicar a carga.
- Um novo layout de planilha entra pelo mapeamento de cabeçalhos do carregador: as telas continuam lendo `raw_values` nas
  mesmas chaves, sem conhecer a versão do arquivo.
- Texto novo de tela vai para `pt-BR.ts`, `en.ts` e `zh-CN.ts`.
- Os gatilhos de fornecedor, saldo e ciclo de vida não são desativados. Alocações entram com a PO ativa; o ciclo de vida muda
  depois.

## Critérios de aceite

| Verificação | Esperado |
|---|---|
| Linhas de origem | 7.639 de Pré + 220 de Pós = 7.859 |
| POs | 366, com número de 6 dígitos: 37 `CANCELLED`, 218 `CLOSED`, 111 `ACTIVE` |
| Itens | 7.553, dos quais 670 cancelados |
| IPs | 224 |
| Alocações | 6.018 |
| Status por IP do Pós | Igual à planilha nos 220 |
| Qualidade | 3 POs sem fornecedor, 86 linhas sem PO, a linha HEXING da 18751, SCs com 2 fornecedores e datas inválidas |
| `#N/A` e `0` | Nenhum nos campos operacionais tratados |
| Repetição | Segunda execução responde "já promovido" sem gravar |
| Telas | Carteira, Carteira por produto, End to End, detalhe de PO e IP e `/source-audit` abrem com o volume real no Preview |
| Testes | API, web, type-check, lint e build passando; testes do carregador cobrindo as regras acima |

## Fora do escopo

- Produção e Pull Request para `main`, antes da aprovação no Preview.
- Abas End-to-End, Import Clearance Estimations, Validação de Impostos, Ex-Tarifário, NCM, Diferimento de ICMS e Tabelas.
- Fines, Storage e Demurrage.
- Várias SCs por PO como modelo de dados.
- Integração com Protheus.

## Plano

1. Regra do T3 com testes.
2. Migration M075: `documents_ok_date` e quantidade de contêiner decimal no IP; `analyst` e `si_number` na PO; `file_values`
   na linha de origem; entidade `ANALYST`; solicitante opcional na SC; preço sem moeda em item importado. Ajuste de rotas,
   formulários e dicionários.
3. Colunas novas e rótulos de Qualidade nas telas de auditoria.
4. Carregador: transformação pura, testes, relatório de simulação e `--apply` só no HML.
5. Backup, limpeza da simulação, ensaio em cópia restaurada e conferência.
6. Aplicação no HML, publicação da API e do web e validação no Preview.
7. Associação do T0 pela SC, quando o arquivo `Status PO's` chegar.

## Resultado no HML (2026-10-30)

| Verificação | Resultado |
|---|---|
| Linhas de origem | 7.859 (7.639 Pré + 220 Pós) |
| SCs | 364, das quais 21 sem solicitante |
| POs | 366: 37 `CANCELLED`, 218 `CLOSED`, 111 `ACTIVE`; 3 MTS e 363 Não MTS; 316 vinculadas a uma SC |
| Itens | 7.553, dos quais 670 cancelados e 78 com preço sem moeda |
| IPs e alocações | 224 IPs, 6.018 alocações, 496 vínculos PO–IP |
| Documentos e custos | 222 invoices, 185 NFs, 323 custos |
| Qualidade | 174 pendências: 86 `MISSING_PO`, 78 `PRICE_WITHOUT_CURRENCY`, 4 `SC_MULTIPLE_SUPPLIERS`, 3 `PO_WITHOUT_SUPPLIER`, 2 `INVALID_DATE`, 1 `PO_IP_SUPPLIER_DIVERGENCE` |
| Conciliação | Total por PO igual à planilha nas 366; status calculado igual à planilha nos 224 IPs |
| Repetição | Recusada com `ALREADY_PROMOTED` |

Pontos encontrados pelos testes com o volume real e já corrigidos:

- A lista de IPs levava 8 s, porque varria as linhas de origem para cada IP; com o índice da M076 leva 53 ms.
- O follow-up da PO 030201 levava 6,2 s, porque recalculava as referências de preço e descrição para cada produto; agora leva
  164 ms.
- A exportação de produtos e do End to End falhava com a base completa (6.882 linhas, limite de 5.000); o limite passou a 30.000
  linhas e a exportação completa leva 8 s.

Reconferência: `verify-follow-up-load.mjs` concilia o banco com o relatório da carga, e `accept-follow-up-load.mjs` exercita as
rotas reais (listas, edição de PO e IP históricos, correção de fornecedor, distribuição de saldo, reabertura de PO, preenchimento
de moeda e exportações), desfazendo cada alteração.

Divergências que ficam registradas: em 3 IPs (`H-CWB008/2026`, `H-CWB009A/2026` e `H-CWB009B/2026`) o Due Storage da planilha é
de 4 dias, enquanto o sistema calcula 9. Sem T0, o total do End to End do histórico aparece "sem dado" até a associação do arquivo
`Status PO's`.
