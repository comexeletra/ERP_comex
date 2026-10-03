# Monitor da outbox

M014 cria `audit.outbox_monitor`, uma view que entrega somente metadados da fila
à role da API. Ela exclui `payload` e `last_error`. A rota
`GET /api/v1/admin/outbox` exige sessão Master, usa `users.manage` global e
responde com contagens de eventos prontos, aguardando tentativa, em lease,
descartados e publicados. A lista mostra até 50 eventos não publicados mais
antigos, sem conteúdo de negócio. A resposta usa `Cache-Control: no-store`.

A tela `/admin/outbox` é somente leitura e fica na navegação Master. Ela não
reenvia, publica nem descarta eventos. Os registros prontos continuam pendentes
até existir um consumidor operacional com destino, política de retry e retenção
definidos. O monitor permite medir essa pendência sem fingir que a integração já
foi concluída.
