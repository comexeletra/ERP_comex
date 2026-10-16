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

- Use o alias SSH `erp-validation-vps` definido em `%USERPROFILE%\.ssh\Host erp-validation-vps.txt`.
- A chave privada usada nas sessões anteriores fica em `.local-keys/rf06_ed25519`, relativa à raiz deste repositório. `.local-keys/` está no `.gitignore`.
- Neste ambiente, `ssh` no `PATH` pode apontar para um bloqueio do sandbox; o cliente OpenSSH instalado fica em `C:\Windows\System32\OpenSSH\ssh.exe`.
- Nunca exiba, copie para logs ou inclua em commits o conteúdo da chave. O acesso SSH não autoriza escrita em produção; confirme o banco HML antes de consultar ou gravar dados.

## Retomada da carga oficial de NCM

- Fonte oficial Siscomex de nomenclaturas: `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json`. O JSON contém código, descrição e datas de vigência (`dataInicio` e `dataFim`; também aceite o formato legado usado pela tabela).
- Fonte oficial de atributos por NCM: `https://portalunico.siscomex.gov.br/cadatributos/api/atributo-ncm/download/json`. Manter somente atributos obrigatórios para Importação e os atributos condicionais obrigatórios.
- A documentação do Siscomex descreve limites configuráveis por funcionalidade bastante acessada, em janelas de uma hora, e bloqueio escalonado após reincidências; ela não estabelece um limite global de 3 chamadas/hora para toda a API. Na sessão de 2026-10-16, uma chamada direta ao endpoint NCM acima retornou HTTP 422 com a mensagem de 3 acessos por hora e liberação às `17:59:59` de Brasília. Trate esse número e horário como observação daquela resposta, não como regra permanente. Se ocorrer novo 422, registre a mensagem/horário, pare as tentativas e consulte somente após a liberação atual; não faça polling nem chamadas repetidas para “testar”. Referência: `https://docs.portalunico.siscomex.gov.br/pages/limites-acesso/`.
- A API do sistema mantém cache oficial em memória por 6 horas. Após reiniciar o serviço, a primeira pesquisa oficial pode consumir uma chamada a cada endpoint; coordene a carga HML e a validação da busca para respeitar o limite.
- Na sessão de 2026-10-16, a tentativa de sincronização falhou antes de abrir a transação; nenhum NCM foi sincronizado por essa tentativa. Na próxima sessão, consulte o horário atual retornado pela API em vez de presumir que o horário anterior continua válido.
- O parser compatível com os campos documentados está em `apps/api/src/siscomex-ncm.ts`, commit `2429fcc` da branch `homologacao`. Os testes da API e o build passaram. A API HML recebeu o módulo e respondeu health `200`; backup: `/var/backups/import-erp/hml-siscomex-ncm-2429fcc-20261016T200623Z`.
- A migration M051 está aplicada somente no banco HML `erp_po_totvs_hml`. Antes da carga, a última conferência encontrou 229 NCMs existentes e nenhum dado sincronizado de atributos oficiais. Reconfirme o banco, papel e contagens diretamente no HML antes de gravar.
- Preservar o modelo solicitado: atualizar descrição e vigências dos NCMs já cadastrados que correspondam à tabela oficial; salvar atributos oficiais para esses mesmos registros; preservar os códigos sem correspondência; não inserir a lista completa de mais de 10 mil NCMs na entidade. O restante do catálogo deve continuar acessível pela busca oficial para inclusão individual.
- Executar a carga somente no HML, com transação, auditoria e outbox. Validar após o commit que o total de NCMs da entidade permanece o mesmo, conferir descrições, datas, atributos e registros sem correspondência. Nunca consultar nem gravar no banco de produção para concluir essa tarefa.
