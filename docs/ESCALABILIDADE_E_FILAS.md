# Escalabilidade e processamento em fila

## Arquitetura atual

- O frontend Next.js na Vercel encaminha chamadas para uma API Fastify na VPS.
- A API usa PostgreSQL local e um pool com limite inicial de cinco conexões. A
  role de aplicação tem limite de dez conexões no PostgreSQL.
- As consultas de carteira e histórico já limitam a quantidade de linhas por
  página. Escritas operacionais usam transação, controle de versão e auditoria.
- `audit.outbox_message` registra eventos na mesma transação das escritas. A
  tabela já oferece leases, tentativas e dead letter, mas ainda não existe um
  consumidor operacional. A tela de monitoramento deixa os eventos pendentes
  visíveis.

## Regras para crescer com segurança

1. **Manter curtas as chamadas interativas.** Consultas de tela e gravações que
   precisam de confirmação imediata continuam síncronas, com filtros, paginação,
   limites e transações pequenas.
2. **Mover trabalho demorado para tarefas assíncronas.** Importações grandes,
   exportações pesadas e integrações externas devem retornar um identificador de
   tarefa. A tela consulta o estado e busca o resultado quando estiver pronto.
3. **Persistir a tarefa antes de responder.** A requisição grava a tarefa no
   PostgreSQL e devolve `202 Accepted`. Um worker separado reivindica tarefas
   usando leases e `FOR UPDATE SKIP LOCKED`, com tentativas limitadas,
   backoff, idempotência e estado de falha terminal.
4. **Separar fila de tarefas de eventos de domínio.** A outbox continua sendo a
   ponte transacional para publicar mudanças. A fila de tarefas representa
   trabalho solicitado por usuário, com dono, escopo, progresso e resultado.
   Não marcar eventos publicados até existir um destino e um consumidor reais.
5. **Controlar a pressão no banco.** O total de conexões de todas as instâncias
   da API e dos workers deve caber no limite do PostgreSQL, reservando conexões
   para administração e migrations. Aumentar réplicas exige recalcular os
   pools; cada réplica não deve herdar o máximo inteiro.
6. **Dimensionar com medições.** Acompanhar latência p50/p95/p99 por rota,
   erros e respostas 429/503, conexões ocupadas e em espera, consultas lentas,
   uso de CPU/memória, tamanho da fila e idade da tarefa mais antiga. Ajustes de
   pool, réplicas e workers devem partir desses dados e de uma carga-alvo acordada.

## Fila de exportações aplicada

O CSV da carteira de POs agora é solicitado como tarefa persistente. A API
responde `202 Accepted`, e um worker separado consulta os dados e prepara o
arquivo. A tela acompanha o estado e lista até cinco exportações recentes para
que o usuário possa baixar o CSV por até 24 horas. O acesso exige a mesma conta
e os mesmos escopos de importadora usados ao criar a tarefa.

A fila admite até três tarefas ativas por usuário e 500 no total. O worker
processa uma tarefa por vez, reivindica itens com `FOR UPDATE SKIP LOCKED`, usa
leases de cinco minutos e tenta novamente falhas transitórias até três vezes,
com espera crescente. Cada CSV tem limite de 5.000 POs. Arquivos expiram após
24 horas; falhas terminais ficam disponíveis para consulta por sete dias.
Erros retornam códigos controlados e não persistem detalhes internos.

O serviço de exemplo do worker está em
`deploy/hostinger/import-erp-export-worker.service`. API e worker usam seis
conexões PostgreSQL no total pelo padrão atual (cinco da API e uma do worker),
dentro do limite de dez da role da aplicação. O pool precisa ser recalculado
antes de aumentar réplicas ou concorrência de workers.

As requisições autorizadas de usuários Master também compartilham a lista de
importadoras por até 30 segundos dentro de cada processo e agrupam buscas
simultâneas. Uma importadora nova pode levar até 30 segundos para aparecer no
escopo de um processo já ativo.

## Próximas etapas

Os indicadores agregados continuam síncronos porque retornam pequenos resumos.
Se medições mostrarem latência alta, podem ser pré-calculados ou movidos para a
fila. Exportações completas da auditoria histórica ainda não usam essa fila.
Importações de planilhas também podem ser adicionadas como um tipo de tarefa
separado, com validação e prévia antes de qualquer promoção dos dados.

## Carregamento da planilha histórica

A auditoria da origem agora solicita 50 linhas por página. A API não aceita mais
o parâmetro que desativava a paginação. Os indicadores continuam calculados para
todo o recorte, enquanto os detalhes das inconsistências são buscados apenas
para as linhas exibidas. M033 adiciona um índice parcial para localizar esses
detalhes sem varrer a tabela de inconsistências para cada linha.

Leituras e gravações interativas continuam respondendo diretamente. Para picos
na fila de exportações, a API aplica limites e responde `429` ou `503` com
`Retry-After`; as tarefas ficam no PostgreSQL e sobrevivem a reinícios.

## Preparação operacional

Antes de ativar a funcionalidade na VPS, aplicar M032 após backup restaurável,
instalar a versão correspondente da API e do worker, habilitar o serviço
`import-erp-export-worker` e confirmar a conectividade/saúde dos dois processos.
O build e a validação em uma cópia restaurada devem passar antes do release.
