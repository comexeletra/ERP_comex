# Fluxo de trabalho do repositório

## Homologação antes da produção

- Faça o trabalho cotidiano na branch `homologacao`. Ela publica o Preview usado para validar mudanças antes da produção.
- Antes de editar, confira `git status --short --branch` e preserve alterações locais existentes. Não descarte, sobrescreva ou inclua mudanças alheias à tarefa.
- Confirme que está na branch `homologacao`. Se a árvore de trabalho estiver limpa, atualize-a com `git pull --ff-only production homologacao` antes de começar. Se houver alterações locais, não faça pull sobre elas: preserve-as e avalie a atualização sem sobrescrevê-las. Se o pull não puder avançar em fast-forward, inspecione a divergência e resolva-a explicitamente; nunca use `reset --hard` para forçar alinhamento.
- Faça commits pequenos e descritivos na `homologacao` e publique com `git push production homologacao`. O remoto `production` aponta para o repositório conectado à Vercel.
- Após o push, acompanhe o deployment Preview da branch `homologacao`. Confirme branch, commit e status `Ready`, e valide a aplicação no domínio estável `https://erp-comex-git-homologacao-eletra-comex.vercel.app`.
- Não faça push direto para `main` nem altere a produção durante a validação. Depois que o usuário aprovar os testes, promova as mudanças de `homologacao` para `main` por um Pull Request revisável.
- Após a promoção, atualize `homologacao` com as mudanças de `main` antes do próximo ciclo. Se houver divergência ou conflito, examine e resolva conscientemente; não force o histórico.

## Ambiente e segredos

- Mantenha testes de homologação no ambiente e banco isolados de produção.
- Não copie dados de negócio de produção para homologação.
- Não mostre, registre em commits ou inclua em capturas de tela tokens, senhas, URLs de conexão ou outros segredos. Use variáveis de ambiente e os arquivos protegidos já provisionados.
- Não altere variáveis da Vercel nem configurações da VPS como parte de um deploy de código sem que a tarefa peça essa mudança.
