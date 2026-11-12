# Tarefa: Auditoria da invoice dentro da criação do IP, com confirmação da distribuição

| Item | Valor |
|---|---|
| Data | 2026-11-12 |
| Branch de trabalho | `homologacao` |
| Status | Especificação aprovada pelo usuário em 2026-11-12; aguardando os arquivos para a etapa 0 |

## Contexto

Duas telas leem a mesma invoice HEXING (abas INV e PKL):

- **Auditoria de invoice** (`/invoices/audit`, `components/InvoiceAuditWorkbench.tsx`): confere o conteúdo e o caminho da invoice
  contra o Follow Up enviado no ato, a DATABASE e a lista de fabricantes, e devolve a invoice corrigida com a aba `AUDITORIA`.
  Não grava nada. Regras em `docs/PLANO_AUDITORIA_INVOICE_AVULSA.md` (etapas 1 a 1i).
- **Criação do IP pela invoice** (`components/NewOperationalRecord.tsx`, `POST /api/v1/processes/import-invoice`): distribui as
  linhas pelos saldos das POs do sistema e grava o IP. Tem só parte das regras da auditoria: não lê a DATABASE nem a lista, não
  corrige preço nem pesos, e uma célula PO ilegível bloqueia a invoice inteira.

Conferência de 2026-11-12: o leitor da tela de IP já lê as invoices auditadas pela página (IPH034B, 037A, 037C e a 037D com a célula
dividida), sem problema de linha. A versão da 037D gerada antes da etapa 1i ainda tem a célula `PO 030888&030201` e bloqueia a
invoice.

## Decisões do usuário (2026-11-12)

1. A auditoria (conteúdo e caminho da invoice) e a criação do IP (distribuição dos saldos e gravação) são etapas separadas.
2. Quando a plataforma estiver em produção, o upload do Follow Up cai em desuso: a plataforma é o novo Follow Up. Até lá ficam as
   duas fontes de auditoria: pelas POs da plataforma (banco HML) e pelo Follow Up enviado no ato.
3. A auditoria pelas POs da plataforma é uma subseção da tela "Criar IP pela invoice", que continua existindo sempre. A página
   `/invoices/audit` fica só com o Follow Up e só para auditoria: ela nunca distribui saldo nem grava.
4. Na subseção, a auditoria serve de carga dos saldos no IP: o analista audita, baixa a invoice auditada, confere o arquivo, e a
   tela aguarda a confirmação da distribuição.
5. O IP grava a invoice auditada, com o SHA-256 do arquivo original e o do auditado e todas as decisões com motivo.
6. Master, Administrador e Importação confirmam a distribuição. Compras entra na tela, audita e baixa, sem confirmar.
7. "Completar o cadastro do produto" continua só preenchendo campos vazios, nunca a descrição, agora com os valores auditados; um NCM
   sinalizado como não encontrado na DATABASE não vai para o cadastro.
8. O HML é recarregado com o Follow Up e o MRP atualizados, sem os dados de teste, para testes reais com invoices reais. A limpeza
   apaga todas as POs, IPs e SCs do HML e mantém os cadastros.

## Requisitos

- **R0 Carga do HML:** backup; carregador `deploy/hostinger/import-follow-up-workbook.py` com `--wipe-simulation` e o Follow Up
  atualizado; ensaio com ROLLBACK e relatório para aprovação; gravação; `verify-follow-up-load.mjs` e `accept-follow-up-load.mjs`;
  T0 recarregado com o MRP atualizado (`import-commercial-plan-dates.py`, `verify-commercial-plan-dates.mjs`).
- **R1 Peças comuns**, extraídas de `InvoiceAuditWorkbench`: a montagem das regras em `lib/china-invoice-mapping.ts`, com os
  candidatos vindos do Follow Up ou da API; `CatalogAudit`, o painel da célula PO, o ponto de preço, os grupos das decisões em massa
  e a aba `AUDITORIA`. A página de auditoria passa a usá-las sem mudar de comportamento.
- **R2 Subseção "Auditoria da invoice"** na tela de IP, na criação e na revisão de IP:
  - referência da última carga (DATABASE e lista de fabricantes);
  - NCM e descrição pela DATABASE; NCM não encontrada mantida com motivo ou sinalizada;
  - fabricante, endereço e país pela lista; país de origem do cabeçalho;
  - preço aceito ou corrigido para o preço da PO; INV × PKL mantendo a INV ou usando a PKL;
  - destino PO + código, com o botão "Destinar 0 a esta PO";
  - célula ilegível dividida pelo saldo do sistema, como ponto pendente, sem bloquear a invoice inteira;
  - PO sugerida pelo saldo do sistema (rota nova `POST /api/v1/purchase-orders/invoice-candidates/by-product`);
  - uma confirmação por fornecedor do Exporter; unidade (só no IP, porque o Follow Up não tem unidade);
  - decisões em massa no topo.
- **R3 "Baixar invoice auditada":** o mesmo arquivo da página de auditoria, com a fonte "POs da plataforma" na aba `AUDITORIA`.
- **R4 "Confirmar distribuição":** habilitado só depois do download do estado atual; qualquer decisão alterada depois exige baixar
  de novo. Só Master, Administrador e Importação.
- **R5 Gravação da invoice auditada:** linhas como no arquivo baixado (NCM, descrição, fabricante, célula PO, quantidade, preço,
  pesos e totais); `fileSha256` continua sendo o do arquivo original (a busca de invoice duplicada usa esse SHA);
  `auditedFileSha256` é o do auditado; `metadata.audit` guarda as cargas usadas, o valor original de cada campo alterado, as
  decisões e os motivos; a auditoria do IP registra as decisões.
- **R6 A API confere de novo, sem confiar na tela:** cada campo alterado tem decisão e valor original; NCM, descrição e fabricante
  batem com as linhas da M082 das cargas citadas, e elas são as últimas (senão 409); preço corrigido igual ao único preço CNY das POs
  que recebem a linha; POs da célula dividida vindas da célula original; PO sugerida registrada de → para; continuam as conferências
  de saldo, PO + código, unidade e fornecedor. Os espelhos das regras na API têm teste que os compara com a web.
- **R7 Cadastro do produto:** decisão 7.
- **R8** Textos nos três idiomas, regras de layout e componentes padrão.

## Restrições

- A invoice nunca altera o item da PO. A página com o Follow Up nunca grava.
- Módulos de `lib/` sem import de valores entre si; schemas `.strict()`; campo novo entra na API e na web no mesmo commit; a API
  sobe antes da web.
- Só HML: ensaio com ROLLBACK (`rehearse-invoice-save.mjs`) antes de cada release da API.
- Os testes atuais da auditoria continuam passando sem mudança.
- Até a etapa 6 a gravação continua como hoje; a troca para a invoice auditada acontece numa etapa só, para o Preview nunca gravar
  algo diferente do que mostra.

## Critérios de aceite

| # | Critério | Teste |
|---|---|---|
| 1 | HML recarregado: conciliação com o relatório da carga; sem POs, IPs e SCs de teste; T0 conferido | verify/accept no HML |
| 2 | Com os mesmos candidatos, a subseção e a página de auditoria chegam às mesmas decisões e ao mesmo arquivo nas IPH034B, 037A, 037C e 037D | web (arquivos reais; pulados sem eles) |
| 3 | Rota by-product: saldo, ordem, importadora, IP em revisão excluído | API + ensaio HML |
| 4 | Célula ilegível vira ponto pendente; divisão pelo saldo; destino 0 com motivo | web + API |
| 5 | Confirmar só depois do download do estado atual; Compras sem confirmar | web |
| 6 | A API recusa campo alterado sem decisão, valor fora da carga, carga desatualizada, preço corrigido diferente do da PO e PO que não estava na célula | API |
| 7 | Espelhos da API iguais à web; payload aceito pelos schemas `.strict()` | API |
| 8 | Gravação real de uma invoice real no HML, primeiro com ROLLBACK e depois pela tela no Preview | ensaio HML + Preview |
| 9 | Montar 20 vezes a IPH034B com a referência leva menos de 2 s | web |
| 10 | Três idiomas, layout, suítes, lint, type-check e builds; API HML atualizada; Preview `Ready` | web + API + VPS |

## Fora do escopo

Gravar a partir da página com o Follow Up; mudar as cargas de referência; produção e `main`.

## Plano

0. Carga do HML com o Follow Up e o MRP atualizados.
1. Extrair as peças comuns e ligar os arquivos reais nos testes.
2. Subseção, parte de conteúdo: DATABASE, NCM não encontrada e fabricantes (web).
3. Subseção, parte de caminho: preço, INV × PKL, destino 0, célula ilegível, PO sugerida (rota e API), fornecedor.
4. Decisões em massa.
5. Download e confirmação condicionada ao download.
6. Gravação da invoice auditada: API, espelhos, ensaio no HML, release na VPS e troca na web.
7. Teste real com invoices reais no HML; atualizar `AGENTS.md` e este plano.

## Arquivos de teste (fora do Git, em `invoices_tests/`)

Os testes com arquivos reais são pulados quando os arquivos não existem; em 2026-11-12 a pasta só tinha a DATABASE, a lista e
`reference-hml.json`. Para a etapa 0 e a paridade são necessários: o Follow Up atualizado, o `FUP POS - MRP.xlsx` atualizado e as
invoices originais e auditadas pelas analistas da IPH034B, 037A, 037C e 037D.
