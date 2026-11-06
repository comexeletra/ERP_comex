# Tarefa: Estimativas de desembaraço (Import Clearance Estimations) no Pós Embarque

## Objetivo

Trazer para `/reports/post` a segunda seção do painel de Pós Embarque do BI, "Import Clearance Estimations": o que
chega ao porto brasileiro e precisa ser registrado na próxima semana, e quanto de impostos o desembaraço envolve. A
análise usa os dados de Pós Embarque do IP e uma **estimativa de impostos digitada no IP**; a aba "Import
Clearance Estimations" da planilha Follow Up não é carregada (decisões do usuário, 2026-11-06).

## Painel de origem (Power BI)

- Filtros: Search IPs, Analyst, Buyer (Importer), Status, Supplier, Status Register, Período (Próxima semana / Todas).
- Tabela: IP Number, Date to Register, Analyst, Buyer (Importer), Status, Supplier, ETA port, Status Registro,
  Value Need, com total do Value Need.
- Filtro Período (DAX do usuário): semana de segunda a domingo (`WEEKDAY(Hoje, 2)`); "Próxima semana" mostra a
  data entre a segunda da próxima semana e o domingo seguinte; "Todas" mostra tudo.

## O que os dados de Pós Embarque cobrem (conferido no HML em 2026-11-06)

Comparação dos 181 IPs que estão na aba e no HML, e dos 39 IPs ainda não entregues:

- IP, importadora, fornecedor, status e ETA vêm do IP (ETA em 35 dos 39 não entregues).
- A data da DUIMP é a data real do registro: igual à "Date to register" da aba em 54 de 169 casos, quase sempre 1 a 3
  dias depois nos outros. Nenhum IP tem DUIMP no futuro, então ela sozinha nunca mostra a próxima semana.
- "Impostos pagos (R$)" do Pós Embarque existe em 11 dos 39 não entregues e é igual ao Value Need da aba em 6 de 137
  IPs com os dois valores (a aba guarda a estimativa; o Pós, o valor pago ou já estimado).
- O analista disponível é o das POs do IP, não o analista do desembaraço da aba (iguais em 11 de 153).

## Decisões do usuário (2026-11-06)

- **Fonte:** dados de Pós Embarque do IP, sem carga da planilha. A M078 (três colunas vazias criadas antes desta
  decisão) foi removida pela M079.
- **Estimativa (decisão posterior do mesmo dia):** os Impostos pagos só existem depois do registro, então o Value
  Need da próxima semana precisa de um campo próprio. A M080 cria `clearance_estimate_brl` no IP ("Estimativa de
  impostos do desembaraço (R$)"), digitado no formulário de Pós Embarque do IP por quem prepara o registro,
  separado de `taxes_paid_brl` (valor pago).
- **Data de referência:** a data da DUIMP para o IP registrado; sem DUIMP, o ETA porto (o registro acontece em torno
  da chegada). "Próxima semana" usa essa data, com a regra do DAX e "hoje" de Brasília (`todayInBrasilia`).
- **Registrado:** "Sim" quando o IP tem número ou data da DUIMP; "Não" sem ela.
- **Valor:** a estimativa do IP; sem estimativa, os Impostos pagos (R$), e a tela diz qual dos dois é ("estimado"
  ou "pago"). IP sem nenhum dos dois mostra traço e não soma.
- **Analista:** os analistas das POs ligadas ao IP (`purchase_order.analyst`, pelas alocações ativas).
- **Importadora:** a importadora do IP (razão social), a mesma do filtro do Pós Embarque.
- **Universo:** IPs não excluídos com data de referência (DUIMP ou ETA) ou com valor. "Todas" mostra todos eles.
- **Exportação Excel:** fica para uma tarefa seguinte.

## Requisitos

1. Rota `GET /api/v1/reports/post-shipment/clearance-estimates` com filtros (IP, analista, importadora, status,
   fornecedor, registrado, período) e escopo de importadora do usuário; devolve as linhas, o total do valor, a semana
   seguinte e as opções dos filtros. Funções puras para a semana, a data de referência e o "registrado", testadas.
2. Seção na tela `/reports/post`, depois dos gráficos, com os filtros e a tabela do BI, a linha de total e os textos
   nos três idiomas. A data mostra se veio da DUIMP ou do ETA. Ordem: data de referência, depois IP.
3. M079 (só HML) remove as três colunas da M078, recusando-se a rodar se alguma tiver valor; o script de carga da
   aba sai do repositório.
4. M080 (só HML) cria `clearance_estimate_brl` (decimal ≥ 0) no IP; o campo entra no formulário de Pós Embarque do IP
   (só do IP, não repetido nos produtos), com a mesma auditoria dos demais.

## Restrições

- Nenhum cálculo de imposto a partir das alíquotas por NCM (`docs/TRATAMENTO_TRIBUTARIO_NCM_E_DESPACHO.md`).
- Rota leve (uma linha por IP, sem recalcular produtos), fora da fila de `work-gate.ts`.

## Critérios de aceite

- Com hoje = sexta 06/11/2026, "Próxima semana" traz os IPs com DUIMP ou, sem ela, ETA entre 09/11 e 15/11.
- IP com DUIMP aparece como "Sim" e usa a data da DUIMP; sem DUIMP, "Não" e o ETA.
- O valor de cada IP é a estimativa ou, sem ela, os Impostos pagos, com a origem indicada; o total soma esse valor.
- Editar a estimativa no IP grava auditoria e aparece na seção.
- M079 aplicada no HML com as colunas vazias; M080 aplicada; ledger 80.
- Testes de API, web (inclusive contrato), i18n, layout, type-check, lint e build passando.

## Fora do escopo

- Carga da aba "Import Clearance Estimations"; campos digitados de data planejada e de analista do desembaraço.
- Cálculo automático da estimativa pelas alíquotas por NCM.
- Produção e Pull Request para `main` antes da aprovação no Preview.

## Plano

1. Rota e funções puras com a data de referência, os impostos e os analistas das POs, com testes.
2. Retirar os campos da M078 da API, do formulário e dos dicionários; M079; reverter o script de carga.
3. Seção na tela com a coluna de data de referência e os textos.
4. Release da API no HML (ativar a API nova antes da M079), push e validação no Preview.
5. M080, campo no formulário do IP e valor estimado/pago na seção; release no HML, push e Preview.

## Carga do Value Need (pedido do usuário, 2026-11-06)

Depois da M080, o usuário pediu para copiar o Value Need (coluna K) da aba "Import Clearance Estimations" para a
estimativa dos IPs correspondentes. Só esse valor é carregado; analista, data para registro e as demais colunas não.

- Script: `deploy/hostinger/import-clearance-estimates.py` (testes em `test_import_clearance_estimates.py`). Não
  conecta ao banco; gera um SQL que só roda no `erp_po_totvs_hml`, termina em ROLLBACK sem `--commit`, só preenche
  estimativas vazias, audita cada IP (`HISTORICAL_IMPORT`, `clearance_estimate_brl`) e recusa uma segunda execução.
- IP casado por `normalized_ip_number`; linhas de agrupamento ("MAY POS") ficam de fora; IP repetido com valores
  diferentes fica de fora para o usuário decidir: **Z-004B/2026** (linhas 108 e 135) e **028A/2025** (189 e 190).
- Resultado no HML com a planilha `a9134344…15bc`: 410 IPs da aba com valor, **176 preenchidos**, 1 mantido (já
  digitado), os demais não existem no sistema (IPs de 2024 e 2025). 177 IPs com estimativa e 176 linhas de
  auditoria. Para desfazer: limpar `clearance_estimate_brl` dos IPs com auditoria do ator
  `migration:clearance-estimate-load`.
