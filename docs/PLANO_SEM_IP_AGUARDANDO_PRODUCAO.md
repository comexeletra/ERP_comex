# Tarefa: juntar "A distribuir" em "Aguardando produção" e criar o filtro "Sem IP"

Status: implementada em 2026-11-13 (commit `88160e6`), aprovada pelo usuário antes da implementação.

## Objetivo

O BI e a planilha Follow Up contam o produto ainda sem IP como *Waiting Production*. O sistema o mostrava num status
próprio, A DISTRIBUIR, e o gráfico de status dividia em duas a fatia do BI. Exemplo do usuário (necessidade jan–fev/2027,
Prioridade): BI Waiting Production 265,57 mil = sistema A distribuir 242,07 mil + Aguardando produção 23,5 mil. Os demais
status batiam (Waiting Arrival 1.523,50 mil, Delivered 14,40 mil).

## Decisões do usuário (2026-11-13)

1. O saldo sem IP (pedido − alocações ativas, só de PO ativa e sem item cancelado no TOTVS) passa a ter o status
   **AGUARDANDO PRODUÇÃO**. O status A DISTRIBUIR deixa de existir na API, nos filtros, nos gráficos e nos cartões.
2. Um filtro **Distribuição em IP** (Todos / Com IP / Sem IP) separa o saldo das alocações no End to End, no Pré Embarque
   e na Carteira por produto, e vale para gráficos, tabela e exportação.
3. Na tela da PO, a linha sem IP mostra "Aguardando produção" e a coluna de quantidade do resumo por item passa a se
   chamar **Sem IP**.
4. **Cor:** Aguardando produção mantém o ocre (`--color-chart-status-2`), mesmo reprovado no validador (abaixo).

## Regras

- API: `BALANCE_STATUS` e `LINE_IP_FILTERS` em `apps/api/src/shipment-lines.ts`; parâmetro `ip=with|without` em
  `/purchase-order-lines`, `/purchase-order-lines/e2e-stages`, `/reports/pre-shipment/summary` e `/lines` e nos corpos
  das exportações (`export-jobs.ts` reaproveita os mesmos schemas). `status=A DISTRIBUIR` responde 400.
- A aba Resumo da exportação do Pré Embarque mostra o filtro como "Distribuição em IP: Sem IP | Com IP".
- A coluna "Line Type" da exportação da Carteira por produto continua separando "Saldo sem IP" de "Distribuição no IP".
- Links antigos com `status=A DISTRIBUIR` perdem só esse valor: a tela descarta status desconhecido.
- O aging do Pré Embarque conta as mesmas linhas de antes (Aguardando produção, agora com o saldo, e Aguardando embarque).

## Cores

A rosca de status fecha o círculo com Aguardando produção ao lado de Entregue. Validador da skill `dataviz` (fechamento
incluído, superfície `#ffffff` no claro e `#1b2a34` no escuro):

| Paleta | Pior par CVD | Pior par visão normal | Resultado |
|---|---|---|---|
| Ocre × verde (mantida) | 3,5 protan no claro; 1,1 deutan no escuro | 14,9 claro; 12,6 escuro | Reprovada |
| Rosa (status-1) para Aguardando produção | 6,7 (rosa × azul) | 21,3 | Aprovada na faixa 6–8 |

As 720 atribuições dos 6 tokens aos 5 status foram testadas; nenhuma passa com CVD ≥ 8, e a melhor é a do rosa. O usuário
preferiu manter o ocre para não mudar a cor conhecida. A legenda com o nome e o espaço de 2 px entre as fatias continuam
obrigatórios, porque são eles que separam as duas fatias para quem tem daltonismo vermelho-verde. Se a cor for revista,
a opção validada é `--color-chart-status-1` para Aguardando produção, sem mudar os tokens.

## Verificação

- Testes da API (`shipment-lines`, `pre-shipment-dashboard`, `purchase-order-export`, `followup-calculations`) e da web
  (`purchase-order-lines`, `pre-shipment-dashboard`, `e2e-lines-view`, `product-lines-view`), com os contratos web ↔ API
  do filtro novo.
- Ensaio só leitura no HML com o filtro do exemplo: Aguardando produção igual ao Waiting Production do BI e Sem IP igual
  ao antigo A distribuir.

## Fora do escopo

- Mostrar "x em IP + y sem IP" na dica de Aguardando produção.
- Painel de Pós Embarque, que não tem esse status.
- A regra de quando um IP está em Aguardando produção (sem invoice).
