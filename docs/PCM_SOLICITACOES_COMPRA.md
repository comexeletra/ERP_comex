# PCM · Solicitações de Compra

O perfil **PCM** cadastra as SCs em `/pcm`, informando a importadora, o número
da SC, sua data de emissão, solicitante, data de recebimento do plano comercial
e, quando disponível, data de aprovação. O número é único por importadora.

No cadastro ou edição de uma PO, Compras e Importação podem selecionar uma SC
da mesma importadora. A seleção preenche os campos operacionais reais dos itens
da PO: número e data da SC, solicitante, aprovação da SC e recebimento do plano
comercial. A data de aprovação da PO permanece independente e também fica
visível no cadastro. O detalhe mantém a visão geral da PO selecionada, sem um
resumo duplicado da SC. POs sem SC continuam permitidas.

O Master, Administrador e PCM podem cadastrar SCs. Compras e Importação podem
consultar as opções para vinculá-las às POs. O acesso segue o escopo de
importadoras da conta. Valores históricos por item permanecem preservados e não
são convertidos automaticamente em SCs cadastradas.

M029 cria `procurement.purchase_request` e o vínculo opcional
`procurement.purchase_order.purchase_request_id`. M030 acrescenta a data da SC
ao cadastro PCM e aos campos operacionais dos itens de PO. A aplicação das
migrations e a publicação da API devem ocorrer antes de publicar a interface web.
