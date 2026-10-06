# Mapeamento do salvamento SC → PO → IP

Atualizado em 2026-10-05. Este mapa distingue o código da interface, o código atual da API e a última publicação da VPS **registrada** no repositório. O estado real da VPS e o conteúdo da PO `TEST-PO-SPLIT-2026-01` exigem leitura autenticada; não foram consultados neste levantamento.

## Modelo e limites dos dados

- SC (`requests`) contém a solicitação e seus itens. O número de SC informado na PO é um campo transcrito do item da PO; não cria uma associação automática com uma solicitação.
- PO (`purchase_order`) contém cabeçalho e produtos (`purchase_order_item`). Campos como aprovação da SC, aprovação/envio da PO e saída da fábrica ficam em cada produto da PO. O botão de campos compartilhados escreve explicitamente esses campos em **cada item**.
- IP (`import_process`) contém a operação após a fabricação. A distribuição (`po_item_allocation`) liga um item da PO a um IP com uma quantidade. Um item pode estar em vários IPs; um IP pode receber itens de várias POs. O saldo é quantidade pedida menos distribuições ativas.
- ETD, ETA, chegada e entrega pertencem ao IP; Invoice/BL/NF pertencem ao IP e podem referenciar um item da PO. Uma PO dividida entre IPs pode, portanto, ter datas de embarque e entrega distintas em cada parcela. Não consolidar essas datas em um campo único da PO.
- Encerrar IP é uma decisão do analista. O status de ciclo é distinto do status logístico e não deve redistribuir quantidades.

## Inventário de escrita e releitura da interface

| Ação | Escrita | Releitura / confirmação | Resultado do exame |
| --- | --- | --- | --- |
| Criar SC com itens | `POST /requests` | resposta e lista `/requests` | Criação atômica na API; lista recarrega, mas não há comparação campo a campo. |
| Editar SC e itens | `PATCH /requests/:id` | resposta completa da própria rota | Resposta usada como estado local; histórico consultado separadamente. |
| Criar PO e produtos | `POST /purchase-orders`, depois `POST /:id/items` e `PATCH /:id/items/:itemId/followup` | `/purchase-orders/:id/followup` após todos os itens | Sequência em transações separadas. Agora compara a existência dos itens e os campos enviados antes de navegar; em falha mantém o rascunho e o link da PO já criada. |
| Cabeçalho da PO | `PATCH /purchase-orders/:id` | `/purchase-orders/:id/operational` | Recarrega após sucesso; ainda não compara todos os campos do cabeçalho. |
| Campos comuns dos produtos | um `PATCH /:id/items/:itemId/followup` por item | `/purchase-orders/:id/followup` | Corrigido: compara todos os campos enviados de todos os itens antes de mostrar sucesso. Pode haver gravação parcial se um item falhar; a mensagem de erro não significa rollback dos anteriores. |
| Editar produto e campos específicos | `PATCH /:id/items/:itemId`, depois `PATCH /:id/items/:itemId/followup` | `/purchase-orders/:id/followup` | Agora confere campos operacionais. As duas escritas são transações distintas; uma falha na segunda pode deixar os dados básicos atualizados. |
| Adicionar produto à PO | `POST /:id/items`, depois `PATCH /:id/items/:itemId/followup` | `/purchase-orders/:id/followup` | Agora confere existência e campos operacionais. Se a segunda etapa falhar, o produto básico já existe. |
| Criar/editar/cancelar distribuição PO → IP | `POST/PATCH/DELETE /purchase-orders/:id/allocations` | `/purchase-orders/:id/operational` | Recarrega quantidades e saldo após sucesso; não compara a distribuição gravada com o pedido enviado. |
| Criar IP | `POST /processes` | resposta e, ao abrir, `/processes/:id` | Recarrega o IP na página de detalhe; ainda não há comparação dos campos após a criação. |
| Editar/encerrar/reabrir IP | `PATCH /processes/:id`, `POST /close`, `POST /reopen` | `/processes/:id` | Recarrega após sucesso; não valida na resposta de leitura todos os campos ou o novo ciclo antes do aviso verde. |
| Dados pós embarque do IP | `PATCH /processes/:id/followup` | `/processes/:id/followup` | Lê da mesma entidade; não há comparação campo a campo após a escrita. |
| Documentos Invoice/BL/NF | `POST/PATCH/DELETE /processes/:id/documents` | `/processes/:id/followup` ou `/purchase-orders/:id/followup` | Listas recarregam; não há comparação após escrita. Datas BL/NF derivadas dos documentos devem permanecer no contexto do IP. |
| Valores de entidades | `POST /operational-values` | `/operational-values` | A interface aguarda a releitura antes de confirmar sucesso. |
| Cadastros (fornecedor/produto/NCM) | `POST/PATCH /:resource` | lista e detalhe `/:resource/:id` | Lista recarrega; não há comparação campo a campo. Candidatos históricos não criam vínculos operacionais. |
| Administração e qualidade | rotas próprias | lista/detalhe de cada módulo | Fora do fluxo PO/IP; respostas e recargas tratadas nas páginas, sem evidência deste defeito específico. |

## Defeito confirmado no código e compatibilidade

Na última versão de API **documentada** na VPS (M021, commit `ed1fc25`), `GET /purchase-orders/:id/operational` não devolve os campos operacionais dos produtos. A interface usava essa resposta para montar os formulários. Já `PATCH /:id/items/:itemId/followup` gravava esses campos e `GET /purchase-orders/:id/followup` os devolvia. Assim, uma gravação podia ter sucesso e a tela voltar vazia. A interface agora combina os dados estruturais de `/operational` com os campos de `/followup`, por ID do item. Se a API não devolver um campo esperado, mostra erro em vez de representar ausência como vazio.

O código local atual da API já contém mais campos em `/operational`, porém não há registro de que essa versão esteja na VPS. Há outras diferenças entre a interface atual e M021: a página de pós embarque espera `GET /processes/:id/followup` e campo de saída efetiva do porto; a interface de encerramento espera o ciclo do IP. Essas rotas/campos surgiram depois da versão documentada. Quando a API antiga responde erro, o problema é incompatibilidade de release, não confirmação falsa de salvamento. Confirmar o commit ativo e o ledger de migrations antes de atualizar a API; o código recente usa migrations M022–M024.

## Conferência funcional recomendada

1. Na PO `TEST-PO-SPLIT-2026-01`, anotar o ID de cada produto e os valores atuais em **Acompanhamento da PO**.
2. Em **Preenchimento operacional da PO**, aplicar uma data de aprovação da SC a todos os produtos. O aviso verde só deve aparecer após a releitura de todos os produtos.
3. Atualizar a página e abrir **Acompanhamento da PO**. Conferir a mesma data em cada produto; se divergir, capturar o erro exibido e o horário da tentativa.
4. Alterar um campo específico de um produto e criar outro produto com um campo operacional. Atualizar a página e conferir ambos.
5. Distribuir quantidade parcial do primeiro produto entre dois IPs; incluir no mesmo IP parte de outra PO. Conferir saldos da PO e itens do IP. Registrar ETD/ETA/chegada/entrega separadamente em cada IP e validar que a outra parcela não recebeu essas datas.

Este procedimento não prova o estado anterior da PO sem acesso autenticado. Em especial, campos aparentemente vazios podem já estar gravados no banco e apenas não terem sido mostrados pela leitura antiga.
