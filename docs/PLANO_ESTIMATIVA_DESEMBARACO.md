# Tarefa: Estimativas de desembaraço (Import Clearance Estimations) no Pós Embarque

## Objetivo

Trazer para `/reports/post` a segunda seção do painel de Pós Embarque do BI, "Import Clearance Estimations": quais IPs
devem ter a DUIMP registrada na próxima semana e quanto será preciso para o desembaraço, para a empresa reservar o
recurso. Hoje os dados vêm da aba "Import Clearance Estimations" da planilha Follow Up, preenchida à mão.

## Painel de origem (Power BI)

- Filtros: Search IPs, Analyst, Buyer (Importer), Status, Supplier, Status Register, Período (Próxima semana / Todas).
- Tabela: IP Number, Date to Register, Analyst, Buyer (Importer), Status, Supplier, ETA port, Status Registro,
  Value Need, com total do Value Need.
- Filtro Período (DAX do usuário): semana de segunda a domingo (`WEEKDAY(Hoje, 2)`); "Próxima semana" mostra os IPs
  com `Date to register` entre a segunda da próxima semana e o domingo seguinte; "Todas" mostra tudo.

## Aba de origem (conferida em 2026-11-06, "Follow Up Import 2026 - atualizado .xlsx")

- Colunas: A IP Number, B Analyst, C Buyer (Importer), D Supplier, E Status, F Pre-Registration validation date,
  G ETA port, H REGISTRADO, I Resource granted date (aprovação da Fiona), J Date to register,
  K Value needed for clearance (ESTIMATED), L Estimated CIF. 453 linhas, de 2025 e 2026.
- Só 3 células têm fórmula (`J = G − 6`); o resto é digitado. Date to register não tem regra (ETA − J vai de −20 a
  +8 dias) e Value need não é proporção do CIF (de 0,23 a 2,8).
- O BI usa o status do Pós Embarque, não a coluna E (024A/2026: "Delivered" no BI, "Customs Clearance" na aba).

## Decisões do usuário (2026-11-06)

- **Value Need:** campo novo do IP (estimativa), separado de `taxes_paid_brl` (valor pago). Carregado da coluna K e
  editável no IP.
- **Status Registro:** derivado da DUIMP: "Sim" quando o IP tem número ou data da DUIMP; "Não" sem ela. A coluna H não
  é carregada (está desatualizada: 033/2026 tem DUIMP de 07/10 e consta "Não").
- **Analyst:** campo novo do IP, o analista do desembaraço (Leisiane, João, Nathália), diferente do analista da PO.
  Carregado da coluna B e editável no IP.
- **Período:** regra do DAX acima, pela Date to register (campo novo do IP, coluna J), com "hoje" de Brasília
  (`todayInBrasilia`).

## Requisitos

1. M078 (só HML): em `imports.import_process`, `clearance_analyst` (texto), `registration_target_date` (data) e
   `clearance_estimate_brl` (decimal, ≥ 0). Sem alterar colunas existentes.
2. Os três campos entram no catálogo de campos do Pós Embarque do IP (`processFields` da API e espelho do web), com
   auditoria e outbox iguais aos demais, e aparecem no formulário do IP.
3. Rota `GET /api/v1/reports/post-shipment/clearance-estimates` com filtros (IP, analista, importadora, status,
   fornecedor, registrado, período) e escopo de importadora do usuário; devolve as linhas e o total do Value Need.
   Funções puras para a janela da semana e o "registrado", testadas.
4. Seção na tela `/reports/post`, depois dos gráficos, com os filtros e a tabela do BI, a linha de total e os textos nos
   três idiomas. Ordem padrão: Date to register, depois IP.
5. Carga histórica: o carregador da planilha lê a aba, casa a linha pelo número do IP normalizado e preenche os três
   campos só onde estão vazios; linhas sem IP no sistema vão para o relatório. Ensaio com ROLLBACK antes do `--commit`.

## Restrições

- Status, fornecedor, importadora e ETA continuam vindo do IP; a aba não os sobrescreve.
- Nenhum cálculo de imposto a partir das alíquotas por NCM (`docs/TRATAMENTO_TRIBUTARIO_NCM_E_DESPACHO.md`).
- Rota leve (um IP por linha, sem recalcular produtos); se precisar recalcular linhas, passa pela fila de `work-gate.ts`.

## Critérios de aceite

- Com hoje = sexta 06/11/2026, "Próxima semana" traz só IPs com Date to register entre 09/11 e 15/11.
- IP com DUIMP aparece como "Sim"; sem DUIMP, "Não"; o filtro Registrado segue a mesma regra.
- O total é a soma do Value Need das linhas filtradas; IP sem estimativa não soma e mostra traço.
- Editar os três campos no IP grava auditoria e aparece na seção.
- A carga no HML preenche os IPs encontrados, relata os não encontrados e, repetida, não grava nada.
- Testes de API, web (inclusive contrato), i18n, layout, type-check, lint e build passando.

## Fora do escopo

- Colunas F (Pre-registration validation date), I (Resource granted date) e L (Estimated CIF), que o painel não mostra.
- Cálculo automático do Value Need.
- Produção e Pull Request para `main` antes da aprovação no Preview.

- **Buyer (Importer):** a importadora do IP (razão social), a mesma do filtro Importadora do Pós Embarque; a unidade de
  negócio da coluna C (Energy, Water, Solar) não é carregada.
- **Universo:** IPs não excluídos que têm Date to register ou Value Need. "Todas" mostra todos esses; "Próxima
  semana" recorta pela Date to register.
- **Exportação Excel:** fica para uma tarefa seguinte.

## Plano

1. Funções puras (janela da semana, registrado, filtros) com testes.
2. M078 e catálogo de campos do IP (API e web), com testes de contrato.
3. Rota da seção com testes.
4. Seção na tela, com i18n e testes de layout.
5. Carregador da aba com testes; ensaio e carga no HML.
6. Release da API no HML, Preview e validação.
