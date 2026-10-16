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
