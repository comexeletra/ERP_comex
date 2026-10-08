# PCM · Solicitações de Compra

O perfil **PCM** cadastra as SCs em `/pcm`, informando a importadora, o número
da SC, solicitante, data de recebimento do plano comercial e, quando disponível,
data de aprovação. O número é único por importadora.

No cadastro ou edição de uma PO, Compras e Importação podem selecionar uma SC
da mesma importadora. O cabeçalho da PO mantém o vínculo com o cadastro da SC;
os campos da SC são exibidos na PO a partir desse vínculo, sem duplicar dados
por item. Alterações futuras no registro compartilhado aparecem em todas as
POs vinculadas. POs sem SC continuam permitidas.

O Master, Administrador e PCM podem cadastrar SCs. Compras e Importação podem
consultar as opções para vinculá-las às POs. O acesso segue o escopo de
importadoras da conta. Valores históricos por item permanecem preservados e não
são convertidos automaticamente em SCs cadastradas.

M029 cria `procurement.purchase_request` e o vínculo opcional
`procurement.purchase_order.purchase_request_id`. A aplicação da migration e a
publicação da API devem ocorrer antes de publicar a interface web.
