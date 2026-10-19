# Fluxo de trabalho do repositório

## Homologação antes da produção

- Faça o trabalho cotidiano na branch `homologacao`. Ela publica o Preview usado para validar mudanças antes da produção.
- Antes de editar, confira `git status --short --branch` e preserve alterações locais existentes. Não descarte, sobrescreva ou inclua mudanças alheias à tarefa.
- Confirme que está na branch `homologacao`. Se a árvore de trabalho estiver limpa, atualize-a com `git pull --ff-only production homologacao` antes de começar. Se houver alterações locais, não faça pull sobre elas: preserve-as e avalie a atualização sem sobrescrevê-las. Se o pull não puder avançar em fast-forward, inspecione a divergência e resolva-a explicitamente; nunca use `reset --hard` para forçar alinhamento.
- Faça commits pequenos e descritivos na `homologacao` e publique com `git push production homologacao`. O remoto `production` aponta para o repositório conectado à Vercel.
- Após o push, acompanhe o deployment Preview da branch `homologacao`. Confirme branch, commit e status `Ready`, e valide a aplicação no domínio estável `https://erp-comex-git-homologacao-eletra-comex.vercel.app`.
- Não faça push direto para `main` nem altere a produção durante a validação. Depois que o usuário aprovar os testes, promova as mudanças de `homologacao` para `main` por um Pull Request revisável.
- Após a promoção, atualize `homologacao` com as mudanças de `main` antes do próximo ciclo. Se houver divergência ou conflito, examine e resolva conscientemente; não force o histórico.

## Testes em cada implementação

- Para cada implementação ou correção, crie ou atualize testes automatizados que cubram o comportamento alterado e execute-os antes de considerar o trabalho concluído. Inclua verificações de contrato entre web e API quando uma tela chamar uma rota nova ou alterada.
- Para mudanças da API publicada separadamente na VPS, valide também que a API de homologação recebeu a versão nova e que a rota alterada responde como esperado. Um Preview da Vercel bem-sucedido não confirma que o serviço da API na VPS foi atualizado.
- Faça testes de banco somente em ambiente isolado ou HML, com dados de teste e rollback/limpeza controlados. Nunca use dados de produção para testes.

## Ambiente e segredos

- Mantenha testes de homologação no ambiente e banco isolados de produção.
- Nunca presuma o estado, o conteúdo ou a configuração do banco com base apenas no código, scripts, seeds, logs ou contexto anterior. Ao trabalhar na branch `homologacao`, acesse o banco real de homologação e confira nele os dados e as condições necessários antes de diagnosticar, afirmar ou corrigir qualquer questão relacionada ao banco.
- Confirme que a conexão aponta para o banco HML antes de consultar ou alterar dados. Não use o banco de produção para essas verificações; alterações no HML devem respeitar a autorização da tarefa e preservar dados e registros existentes.
- Não copie dados de negócio de produção para homologação, exceto quando o usuário solicitar explicitamente essa operação. Nesse caso, transfira somente as entidades e os campos solicitados, mantenha o destino isolado em homologação e nunca escreva na produção.
- Não mostre, registre em commits ou inclua em capturas de tela tokens, senhas, URLs de conexão ou outros segredos. Use variáveis de ambiente e os arquivos protegidos já provisionados.
- Não altere variáveis da Vercel nem configurações da VPS como parte de um deploy de código sem que a tarefa peça essa mudança.

## Acesso SSH da VPS de homologação

- No notebook da empresa, use o alias SSH `erp-validation-vps` definido em `%USERPROFILE%\.ssh\Host erp-validation-vps.txt`. A chave privada dessa máquina fica em `.local-keys/rf06_ed25519`, relativa à raiz do repositório.
- No desktop de casa, a chave SSH funcional fica em `.local-keys/rf06_api_9583966c3df64c5a93048c4c1fb7fe8d.key`. O alias do notebook não está configurado nele; use o host e o usuário documentados em `deploy/hostinger/README.md`, com `-o BatchMode=yes -o IdentitiesOnly=yes -o HostKeyAlias=72.60.250.212 -i .local-keys/rf06_api_9583966c3df64c5a93048c4c1fb7fe8d.key`.
- `.local-keys/` está no `.gitignore` em ambas as máquinas. Nunca inclua uma chave no Git.
- Neste ambiente, `ssh` no `PATH` pode apontar para um bloqueio do sandbox; o cliente OpenSSH instalado fica em `C:\Windows\System32\OpenSSH\ssh.exe`.
- Nunca exiba, copie para logs ou inclua em commits o conteúdo da chave. O acesso SSH não autoriza escrita em produção; confirme o banco HML antes de consultar ou gravar dados.

## Retomada da carga oficial de NCM

- A sincronizacao automatica de NCM executa duas vezes ao dia, as 06:00 e 12:00 (horario de Brasilia), quando `NCM_AUTO_REFRESH_TIME=06:00,12:00` estiver configurado no servico da API HML. Ela e recusada se `DATABASE_URL` nao apontar para `/erp_po_totvs_hml`, atualiza somente NCMs ja cadastradas e grava auditoria/outbox. Cada rodada baixa novamente os dados oficiais; em falha, registra erro e espera o proximo horario fixo, sem tentativas extras. `updated_by` pode ser nulo para o ator de sistema; `created_by` continua obrigatorio. Nao habilitar em producao sem aprovacao.
- O calculo dos proximos horarios e o agendador ficam em `apps/api/src/ncm-sync.ts`; o servico passa a configuracao em `apps/api/src/server.ts`. O agendamento existe apenas enquanto a API esta ativa e recalcula as proximas ocorrencias apos reinicio. Antes de ativar, aplicar M052 somente no HML.

- Fonte oficial Siscomex de nomenclaturas: `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json`. O JSON contém código, descrição e datas de vigência (`dataInicio` e `dataFim`; também aceite o formato legado usado pela tabela).
- Fonte oficial de atributos por NCM: `https://portalunico.siscomex.gov.br/cadatributos/api/atributo-ncm/download/json`. Manter somente atributos obrigatórios para Importação e os atributos condicionais obrigatórios.
- A documentação do Siscomex descreve limites configuráveis por funcionalidade bastante acessada, em janelas de uma hora, e bloqueio escalonado após reincidências; ela não estabelece um limite global de 3 chamadas/hora para toda a API. Na sessão de 2026-10-16, uma chamada direta ao endpoint NCM acima retornou HTTP 422 com a mensagem de 3 acessos por hora e liberação às `17:59:59` de Brasília. Trate esse número e horário como observação daquela resposta, não como regra permanente. Se ocorrer novo 422, registre a mensagem/horário, pare as tentativas e consulte somente após a liberação atual; não faça polling nem chamadas repetidas para “testar”. Referência: `https://docs.portalunico.siscomex.gov.br/pages/limites-acesso/`.
- A API do sistema mantém o catálogo oficial em memória por 6 horas e compartilha downloads simultâneos. Quando a fonte falha, suspende novas chamadas até o mais tardio entre o horário de liberação informado pelo Siscomex e a retentativa progressiva (1 hora inicialmente, dobrando até 6 horas); sem horário legível, aplica somente essa retentativa progressiva. Durante a espera, as rotas respondem `503` com `Retry-After` e horário de Brasília para a interface explicar quando tentar de novo. Esse controle é em memória e reiniciar o serviço o limpa; após reinício, no máximo a primeira requisição volta a consultar a fonte e então o bloqueio é aplicado novamente. Não reinicie repetidamente durante um bloqueio.
- Na sessão de 2026-10-16, a tentativa de sincronização falhou antes de abrir a transação; nenhum NCM foi sincronizado por essa tentativa. Na próxima sessão, consulte o horário atual retornado pela API em vez de presumir que o horário anterior continua válido.
- O parser compatível com os campos documentados e o controle de retentativas ficam em `apps/api/src/siscomex-ncm.ts`; o provider é conectado à rota de busca em `apps/api/src/catalog.ts`. Em 2026-10-16, o commit `165108b` instalou esses módulos na API HML `import-erp-hml-api`; o health respondeu `200`. Backup anterior à troca: `/var/backups/import-erp/hml-siscomex-retry-165108b-20261016T173212`. A validação do deploy chamou somente o health e não consultou o Siscomex.
- A migration M051 está aplicada somente no banco HML `erp_po_totvs_hml`. Antes da carga, a última conferência encontrou 229 NCMs existentes e nenhum dado sincronizado de atributos oficiais. Reconfirme o banco, papel e contagens diretamente no HML antes de gravar.
- Preservar o modelo solicitado: atualizar descrição e vigências dos NCMs já cadastrados que correspondam à tabela oficial; salvar atributos oficiais para esses mesmos registros; preservar os códigos sem correspondência; não inserir a lista completa de mais de 10 mil NCMs na entidade. O restante do catálogo deve continuar acessível pela busca oficial para inclusão individual.
- Executar a carga somente no HML, com transação, auditoria e outbox. Validar após o commit que o total de NCMs da entidade permanece o mesmo, conferir descrições, datas, atributos e registros sem correspondência. Nunca consultar nem gravar no banco de produção para concluir essa tarefa.
