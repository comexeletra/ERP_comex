# Mapeamento dos valores operacionais

Os valores cadastrados em `/catalog/values` são lidos por `GET /api/v1/operational-values`.
Os seletores carregam a lista sem cache para que inclusões recentes apareçam ao abrir
ou atualizar as telas.

| Entidade | Campos de destino |
| --- | --- |
| Importadora (`importer`) | Importadora em SC, PO e IP; escopos de importadora no cadastro de usuários Master. |
| Incoterm (`incoterm`) | Dados de acompanhamento do IP. |
| Modal (`transport_mode`) | Dados de acompanhamento do IP. |
| POL / porto de origem (`port_loading`) | Dados de acompanhamento do IP. |
| POD / porto de destino (`port_discharge`) | Dados de acompanhamento do IP. |
| Moeda (`currency`) | Preço do item da PO, frete do IP e moeda de Invoice. |
| Categoria (`category`) | Campo operacional do item da PO. |
| Grupo de produto (`product_group`) | Campo operacional do item da PO, separado de `Group`. |
| Group (`group`) | Campo operacional `Group` do item da PO. |
| Finalidade (`purpose`) | Item da PO e item de solicitação de compra. |
| Demanda (`demand`) | Campo operacional do item da PO. |
| Status logístico (`logistics_status`) | Cadastro e acompanhamento do IP e filtro da lista de IPs. |
| Canal aduaneiro (`customs_channel`) | Dados de acompanhamento do IP. |
| Tipo de container (`container_type`) | Dados de acompanhamento do IP. |
| Prioridade (`priority`) | Item da PO e cadastro/acompanhamento do IP. |
| Unidade de medida (`unit_of_measure`) | Unidade do item da PO. |
| Solicitante (`requester`) | Cadastro de SC no PCM, item da PO e referência de solicitante na solicitação de compra. |
| Centro de custo (`cost_center`) | Item da PO e item de solicitação de compra. |
| Despachante (`broker`) | Dados de acompanhamento do IP. |
| Agente de carga (`forwarder`) | Dados de acompanhamento do IP. |

Os formulários de criação e edição de SC/solicitação usam as mesmas entidades de
solicitante, finalidade e centro de custo que os itens da PO. Dados históricos que
não correspondam a um valor atual continuam visíveis como “valor atual” durante a
edição, sem serem apagados.
