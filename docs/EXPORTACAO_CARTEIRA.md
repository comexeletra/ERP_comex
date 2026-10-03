# Exportação CSV da carteira de POs

Na carteira (`/`), o botão **Exportar carteira filtrada (CSV)** consulta todas as
páginas do endpoint já autorizado `GET /api/v1/purchase-orders`, com os filtros
aplicados na tela. O arquivo contém uma linha por PO visível ao usuário: número,
importador, estado de identidade e contagens históricas de observações, IPs,
linhas com/sem IP e pendências abertas. Não contém saldos, valores ou itens
oficiais, que ainda dependem da fonte TOTVS aprovada.

Na visão da carteira, o resumo também exibe a data/hora de promoção mais recente
do snapshot histórico presente nas linhas das POs do recorte atual. A referência
respeita filtros e escopo do usuário; ela indica a carga histórica disponível,
não atualização ou sincronização com o TOTVS. O CSV não inclui essa referência.

A exportação é limitada a 5.000 POs por vez. Se a contagem mudar durante a
paginação ou surgir uma PO duplicada, a tela pede nova tentativa; não gera um
arquivo silenciosamente incompleto. O CSV usa UTF-8 com BOM e protege texto que
o Excel poderia interpretar como fórmula. Como as páginas são consultadas em
requisições separadas, o arquivo não é um snapshot transacional do banco.
