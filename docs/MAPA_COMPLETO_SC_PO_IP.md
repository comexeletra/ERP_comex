# Mapa completo de dados e vínculos: SC, PO e IP

**Atualizado em 2026-10-10.** Este documento descreve o fluxo de informação entre SC do PCM, PO, itens da PO, IP, distribuições e documentos de embarque. Distingue o que já existe no código local e o que ainda é necessário para atender ao fluxo solicitado.

## 1. Regras de relacionamento

- **SC → PO:** uma PO pode ter uma SC vinculada; uma SC pode ser reutilizada em mais de uma PO. O relacionamento usa o ID da SC e exige a mesma importadora.
- **PO → itens:** uma PO contém um ou mais itens. Quantidade, saldo, produto, preço e unidade pertencem ao item.
- **Item da PO ↔ IP:** relacionamento muitos-para-muitos feito por distribuições. Um item pode ser dividido entre IPs; um IP pode transportar itens de várias POs.
- **PO ↔ IP:** a relação deve ser navegável nos dois sentidos. Para novas associações operacionais, o usuário escolhe item e quantidade; a API grava a alocação e o vínculo PO–IP na mesma transação. Ainda podem existir vínculos históricos sem quantidade (por exemplo, importados de planilhas), que não devem ser tratados como distribuição operacional.
- **Pós-Embarque:** os dados pertencem ao IP. Todas as POs associadas ao mesmo IP consultam os mesmos dados daquele IP; uma PO associada a IPs diferentes apresenta o pós-embarque de cada IP separadamente.
- **Saída da fábrica:** pertence à distribuição item–IP. O mesmo item dividido pode ter uma data diferente em cada IP.

## 2. Mapeamento da SC do PCM para a PO

| Origem — `procurement.purchase_request` | Vínculo/destino | Aplicação nos itens da PO |
| --- | --- | --- |
| `id` | `purchase_order.purchase_request_id` | Chave estável da SC selecionada no campo **SC vinculada**. |
| `importer` | `purchase_order.importer` | Validação obrigatória de igualdade; SC de outra importadora não pode ser selecionada. |
| `scNumber` | `purchase_order_item.sc_number` | Copiar para todos os itens existentes ao salvar a seleção; itens novos herdam o valor comum. |
| `scDate` | `purchase_order_item.sc_date` | Copiar para todos os itens existentes; itens novos herdam o valor. |
| `requester` | `purchase_order_item.requester` | Copiar para todos os itens existentes; itens novos herdam o valor. |
| `approvalDate` | `purchase_order_item.sc_approval_date` | Copiar para todos os itens existentes; itens novos herdam o valor. |
| `commercialPlanReceivedDate` | `purchase_order_item.commercial_plan_received_date` | Copiar para todos os itens existentes; itens novos herdam o valor. |

### Regras para SC

1. A lista da PO deve carregar todas as SCs cadastradas no PCM para a mesma importadora e dentro do escopo do usuário.
2. Depois de criar uma SC, ela deve aparecer no seletor da PO após atualização da lista/página; não se deve redigitar o número da SC manualmente para relacioná-la.
3. Selecionar uma SC deve mostrar os dados que serão aplicados. Salvar deve persistir o ID no cabeçalho e os cinco campos derivados nos itens, preservando os outros campos dos itens.
4. Uma SC pode ser vinculada a várias POs. Não remover uma SC da lista apenas porque ela já aparece em outra PO.
5. **Regra desejada ainda não implementada:** se os dados da SC forem alterados depois da associação, não atualizar os itens da PO silenciosamente. Sinalizar a divergência e oferecer atualização explícita e auditada. O estado atual mantém os valores copiados na PO; não há detecção/propagação automática de alterações posteriores na SC.
6. **Regra desejada ainda não implementada por completo:** trocar/remover a SC deve atualizar a referência no cabeçalho e substituir/limpar somente os cinco campos derivados, com confirmação e histórico. O endpoint atual persiste a seleção e os campos derivados atomicamente, mas não foi confirmado que a interface exija confirmação/histórico próprio para a troca. Campos não derivados devem ser preservados.

**Estado local após esta alteração:** o seletor `SC vinculada` carrega SCs por importadora. A seleção preenche os cinco campos comuns dos itens; para a API atual, o vínculo do cabeçalho e a aplicação dos campos a todos os itens agora usam `PATCH /api/v1/purchase-orders/:id/complete` em uma transação, com validação da importadora, conjunto de itens e releitura. Novos itens usam os valores comuns selecionados. O endpoint retorna `purchaseOrderCount`, mas a lista não exclui SCs já utilizadas. Como compatibilidade, uma API antiga sem essa rota ainda exige a sequência separada de gravações e não oferece a mesma atomicidade. O módulo `/requests` é uma solicitação interna e não deve ser confundido com a SC do PCM (`purchase_request`).

## 3. Dados criados na PO

| Entidade | Campos | Escopo |
| --- | --- | --- |
| Cabeçalho da PO — `procurement.purchase_order` | Importadora, número TOTVS, fornecedor informado, data da PO, observações, ID da SC vinculada, versão e origem | Compartilhado por todos os itens da PO. |
| Item — `procurement.purchase_order_item` | Linha/referência TOTVS, produto/código/descrição, quantidade pedida, unidade, preço/moeda | Específico de cada produto/linha. Quantidade e saldo são controlados por item. |
| Pré-Embarque do item | Data de necessidade, número/data/aprovação da SC, recebimento do plano comercial, prioridade, demanda, solicitante, finalidade, centro de custo, Draft PO, aprovação/envio da PO, categoria, grupo do produto, NCM, observações, conclusão do MRP e metas de dias de MRP/pedido/embarque/porto/trânsito/desembaraço | Atributos do item da PO. Campos comuns podem ser aplicados a todos os itens; produto, quantidade, metas e demais campos específicos não devem ser sobrescritos por engano. |

## 4. Mapeamento PO–IP, quantidades e visibilidade

| Origem | Destino/relação | Dados e regra |
| --- | --- | --- |
| PO + importadora | `imports.import_process.importer` | PO e IP associados devem pertencer à mesma importadora e ao escopo autorizado. |
| PO e IP | `procurement.process_purchase_order` | Relação PO–IP muitos-para-muitos, identificada pelos IDs; sem duplicar a mesma relação. |
| Item da PO e IP | `procurement.po_item_allocation` | Guarda item, IP, quantidade, observações, status, versão e data de saída da fábrica. |
| Quantidade pedida do item | Soma das distribuições ativas do item | Saldo = quantidade pedida − soma das distribuições ativas. Não permitir saldo negativo/excesso, inclusive em concorrência. |
| Distribuição cancelada | Histórico da distribuição e saldo | Cancelar libera somente sua quantidade; preservar histórico e outras distribuições/vínculos. |

### Fluxo de associação a partir da PO

1. No item da PO, pesquisar IP já existente pela identificação, filtrando pela importadora da PO.
2. Selecionar o IP; informar item, quantidade e observações.
3. Salvar distribuição. A operação valida escopo, importadora, IP aberto/não cancelado, item ativo e saldo; persiste a distribuição e a relação PO–IP.
4. Atualizar a PO e o detalhe do IP para confirmar os dois lados do vínculo.
5. Repetir para dividir o item entre outros IPs ou distribuir outros itens/POs ao mesmo IP.

**Estado local observado:** a PO já oferece busca/seleção de IP existente e distribuição por item. A busca sozinha não efetiva o vínculo; é preciso salvar a quantidade. A API cria a relação PO–IP na transação da distribuição. Vínculos históricos sem alocação podem continuar visíveis, mas não representam quantidade operacional.

### Fluxo de distribuição a partir do IP

No detalhe do IP, pesquisar/selecionar uma PO existente da mesma importadora, selecionar um item da PO, conferir o saldo atual e informar a quantidade que ficará naquele IP. Salvar usa a mesma operação transacional de distribuição já usada pela PO; a operação cria a relação PO–IP e a alocação juntas. O saldo é calculado por item: quantidade pedida menos todas as alocações ativas para todos os IPs. Não há nova associação operacional sem item e quantidade, para não criar vínculo sem saldo rastreável. A ação pode ser repetida para outros itens e outras POs.

**Estado local após esta alteração:** o detalhe do IP consulta itens, alocações existentes e saldos atuais da PO; mostra o saldo previsto após a quantidade digitada; bloqueia quantidade inválida/excedente na interface e o backend continua fazendo a validação transacional autoritativa. Depois de salvar, relê o IP e a PO. Na PO, cada linha da distribuição mostra IP, quantidade naquele IP, quantidade pedida do item e saldo restante do item na PO. Na tela do IP, “quantidade neste IP” é a parcela deste IP; “saldo restante na PO” é o saldo global do item depois de somar todos os IPs. Uma PO pode aparecer em vários IPs e um IP pode receber itens de várias POs. A rota exige chave de idempotência: repetir a mesma chave e conteúdo reproduz o resultado; reutilizá-la com conteúdo diferente retorna conflito. Uma nova chave para repetir uma alocação ativa do mesmo item/IP é rejeitada pela restrição de unicidade. Essa versão local ainda precisa ser publicada para aparecer no ambiente hospedado.

## 5. Campos do IP compartilhados com todas as POs associadas

Os seguintes dados residem em `imports.import_process`. Devem ser vistos pelas POs relacionadas por meio do IP e nunca copiados para um campo único da PO:

- Identificação e controle: importadora, número do IP, status logístico, prioridade, ciclo aberto/encerrado, observações e data do IP no TOTVS.
- Embarque: modal, Incoterm, despachante, porto de origem, porto de destino, ETD, ETA confirmada, saída efetiva do porto de origem, chegada efetiva.
- Aduana e entrega: DUIMP, data de registro da DUIMP, canal aduaneiro, desembaraço, ETE confirmada, solicitação da NF, entrega efetiva.
- Custos/contêineres: moeda e valor do frete, container/tipo/quantidade, agente de carga, impostos pagos, multa, armazenagem, demurrage e quantidade de containers com demurrage.
- Conferência e previsão: documentação conferida e vencimento confirmado da armazenagem.

Se uma PO usa IP-1 e IP-2, exibir dois contextos/linhas de embarque com datas independentes. Se PO-A e PO-B usam IP-1, ambas consultam as mesmas datas e demais campos do IP-1. Alterar o Pós-Embarque de IP-1 reflete-se nas duas POs relacionadas a esse IP; não altera IP-2.

## 6. Documentos e associação a itens

| Documento | Dono | Ligação opcional/obrigatória com item | Dados relevantes |
| --- | --- | --- | --- |
| Invoice | IP | Pode apontar para item da PO; para comparar quantidade/preço, associar ao item correto que está alocado ao IP | Número, emissão, homologação quando aplicável, quantidade, preço unitário, valor, moeda, observações, status. |
| BL | IP | Pode ser documento geral do IP | Número, emissão e observações. |
| NF | IP | Pode ser documento geral do IP | Número, emissão, homologação e observações. |

Um documento que referencia item deve apontar para uma alocação ativa do item no mesmo IP. Datas de BL/NF e resultados derivados são daquele IP; não preencher datas do outro IP nem criar totais duplicados por junção PO–IP.

## 7. Contrato de leitura, gravação e auditoria

- Toda seleção/gravação deve retornar IDs estáveis e valores persistidos; a interface deve reler o registro antes de confirmar sucesso.
- Após uma associação, a leitura da PO deve listar seus IPs e a leitura do IP deve listar suas POs. A leitura precisa incluir itens/alocações e quantidades quando existirem.
- A API deve validar novamente importadora, escopo, estado aberto, status cancelado e saldo; esconder registros fora do escopo.
- Gravações de SC vinculada + campos derivados e de distribuição devem ser transacionais, idempotentes quando houver repetição da requisição, versionadas e auditadas com ator/motivo/valores anterior e novo.
- Desconhecido permanece nulo. Não inferir datas, quantidades, custos, vínculo de SC ou associação PO–IP com base em coincidência de texto.

## 8. Critérios E2E de aceite

1. Criar duas SCs para a mesma importadora e confirmar que ambas aparecem no seletor da PO; criar uma SC para outro importador e confirmar que não aparece.
2. Selecionar SC-A na PO e confirmar referência no cabeçalho e número, data, solicitante, aprovação e recebimento do plano comercial em todos os itens. Adicionar item e confirmar herança. Trocar para SC-B e confirmar substituição somente dos campos derivados, com confirmação/auditoria.
3. Criar IP-1 e IP-2; a partir da PO, buscar IP-1 já criado, selecioná-lo, distribuir parte de um item e confirmar o vínculo no detalhe do IP.
4. A partir de IP-1, selecionar PO-A e PO-B, escolher um item e quantidade para cada distribuição. Confirmar ambas as POs no IP e IP-1 em cada PO; repetir com IP-2 na PO-A.
5. Dividir item de 100 unidades: 40 para IP-1 e 60 para IP-2. Confirmar saldo zero, datas de saída da fábrica independentes e rejeição de tentativa de exceder a quantidade.
6. Gravar datas ETD/saída efetiva/chegada/entrega distintas em IP-1 e IP-2. Confirmar que ambas as POs ligadas ao IP-1 veem os mesmos dados de IP-1, e que nenhuma dessas datas aparece como pertencente ao IP-2.
7. Testar importador incompatível, IP encerrado/cancelado, duplicidade de alocação ativa do mesmo item/IP, documento apontando para item não alocado e concorrência por saldo. Verificar também replay idempotente com a mesma chave/conteúdo e conflito ao reutilizar a chave com conteúdo diferente. Cada erro deve deixar os outros registros e vínculos intactos.

## 9. Limites da validação executável

Em 2026-10-10, os contratos de resumo, relatórios, PO/IP e pós-embarque passaram contra uma cópia restaurada do banco operacional hospedada na VPS, com schema M031. A jornada HTTP completa `Next.js → gateway → API → PostgreSQL` também passou em outra cópia descartável M031: criou SC, vinculou à PO, distribuiu 40+60 unidades entre dois IPs, conferiu saldo zero, datas independentes, fechamento/reabertura e releitura direta dos registros. As cópias `_ci` e os serviços temporários foram removidos; o ledger do banco operacional permaneceu em M031. Os testes de integração continuam protegidos para só aceitar bancos locais `_ci`/`_test`; a validação usou clones de produção e não gravou o fluxo de teste no banco operacional. As regras de divergência/auditoria de SC editada e confirmação na troca precisam de implementação e teste de integração próprios antes de serem consideradas cobertas.
