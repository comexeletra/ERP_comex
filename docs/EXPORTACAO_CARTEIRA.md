# Exportacao Excel da carteira de POs

Na carteira (`/`), o botao **Exportar carteira filtrada (Excel)** cria uma tarefa
na fila. O worker gera um arquivo `.xlsx` com uma linha por PO visivel ao usuario:
numero, importador, identificador e contagens de itens, IPs e pendencias abertas.
O arquivo respeita os filtros e o escopo do usuario e nao inclui saldos ou valores
monetarios.

A exportacao e limitada a 5.000 POs por vez. A tela acompanha a tarefa e baixa o
arquivo quando o worker termina. As planilhas ficam disponiveis por 24 horas.
