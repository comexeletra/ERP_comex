# Acompanhamento operacional da PO (M019–M020)

O preenchimento é feito na página da PO. O cadastro principal da PO, seus itens e as quantidades por IP continuam no painel **Preenchimento operacional da PO**. O painel **Acompanhamento da PO** registra os dados complementares do item e do IP e os documentos individuais. IPs já vinculados pelo histórico também aparecem para preenchimento de seus dados gerais, mesmo antes de haver distribuição operacional de itens. Um IP pode conter itens de várias POs; os dados do IP são compartilhados, enquanto a quantidade e as conferências da Invoice são calculadas para cada item/IP. Nenhum desses campos grava no TOTVS ou substitui a observação histórica da planilha.

| Origem da planilha | Onde preencher | Resultado automático |
| --- | --- | --- |
| Necessidade, SC, solicitante, finalidade, centro de custo, aprovação/envio da PO, categoria, NCM, metas e marcos internos | Item da PO | Prazo comercial, intervalos SC/PO, metas e desvios T0–T5, lead time e risco de ruptura |
| Modal, Incoterm, portos, despachante, ETD/ETA, chegada, DUIMP, canal, desembaraço, solicitação de NF, entrega, frete, containers e custos | IP vinculado ao item | ETA/ETE, trânsito previsto, vencimento de armazenagem, status e alertas |
| Invoice, BL e NF | Documentos individuais do IP, com item opcional | Total das Invoices por moeda no IP; quantidade e preço da Invoice conferidos por item/IP; data do BL/NF e homologação |
| Quantidade e preço unitário do item | Cadastro do item da PO | Valor total do item (quantidade pedida × preço unitário) |

## Regras automáticas

- ETA confirmada prevalece. Sem confirmação, é ETD + 55 dias para modal `SEA`/marítimo ou + 10 dias para outros modais. ETE confirmada prevalece; sem ela, é ETA + 10 dias.
- Vencimento da armazenagem confirmado prevalece. Sem ele, é chegada + 9 dias para modal marítimo ou + 5 dias para outros modais.
- O status por item/IP segue os marcos: cancelado, entregue, aguardando produção, aguardando embarque, aguardando chegada, desembaraço. Os alertas apontam o próximo marco vencido ou pendente.
- Há risco de ruptura quando a ETE ultrapassa a data de necessidade menos sete dias. Sem ETE ou necessidade informada, o risco fica indeterminado.
- O prazo do plano comercial é cinco meses antes da necessidade, acrescido de quatro dias. As etapas T0–T5 calculam duração real, meta e desvio em dias corridos somente quando os dados necessários existem. O maior desvio preenchido identifica a etapa gargalo.
- A conferência de quantidade compara a soma das linhas de Invoice vinculadas ao item com a quantidade desse item no IP. A conferência de preço usa o preço da Invoice quando as linhas têm um preço uniforme. Invoices gerais do IP não são atribuídas a um item para essa conferência.
- O total das Invoices pertence ao IP, separado por moeda. Para cada linha, usa o valor informado ou, se ausente, quantidade × preço. Linhas sem moeda/valor aparecem como incompletas. Custos do IP não são rateados entre POs.
- Campos sem insumo suficiente retornam vazio/indeterminado; a API não grava valores calculados. A data corrente para alertas usa `America/Sao_Paulo`.

As buscas da planilha em arquivos externos para plano comercial, MRP e valores de Invoice foram substituídas por campos operacionais e documentos próprios. Algumas fórmulas antigas de T0–T5 apresentavam condições inconsistentes ou apenas valores fixos; as etapas agora usam datas e metas explícitas, de forma que os desvios representem `dias reais − dias de meta`.

## Integridade e validação

M019–M020 adicionam colunas tipadas, documentos individuais, auditoria via rotas existentes e bloqueio de cancelamento de uma distribuição que ainda possui documento ativo ligado ao item. As migrações passaram em PostgreSQL local isolado e em uma cópia restaurada do banco operacional; depois foram publicadas na VPS em 2026-10-04. `apps/api/test/followup.integration.mjs` exerce as rotas reais e reverte todas as gravações ao final. O backup, a reversão da API e a verificação pública estão registrados em `deploy/hostinger/README.md`. A carga do histórico atualizado da planilha fica para uma etapa posterior, conforme definido com o usuário.
