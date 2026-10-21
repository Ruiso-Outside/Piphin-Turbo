# Piphin Turbo

Deixa o PC mais rápido para jogos e limpa o lixo, de um jeito simples. Módulo do [Piphin Hub](https://github.com/Ruiso-Outside/Piphin-Hub) (cerca de 120 KB).

**Princípios**: nada muda sem um clique; tudo é explicado em linguagem simples; toda otimização pode ser desfeita; um ponto de restauração do Windows é criado antes das mudanças de sistema; pedidos da IA sempre passam por uma confirmação na tela.

- **Check-up** com nota de saúde (0 a 100), problemas explicados e o botão **Otimizar tudo** (um único pedido de administrador)
- **Limpeza**: temporários (pula os recentes e as pastas que programas abertos estão usando), temporários do Windows, cache dos navegadores (sem senhas, histórico ou cookies), cache de apps (Discord, Steam, Teams), downloads antigos do Windows Update, relatórios de erro; opcionais: cache de shaders e Lixeira
- **Jogos**: plano de alto desempenho, Modo de Jogo, desligar a gravação em segundo plano, otimizações para jogos em janela, agendamento de GPU por hardware, prioridade para jogos, mouse sem aceleração, efeitos visuais leves, apps em segundo plano; cada um com o valor original guardado para **Desfazer**
- **Inicialização**: liga/desliga programas que abrem com o Windows (o mesmo mecanismo do Gerenciador de Tarefas), com dicas do que pode desligar
- **Programas abertos** por uso de memória, com fechar educado (como clicar no X)
- **Modo Turbo** para a hora de jogar: alto desempenho + fechar programas escolhidos; desliga com um clique
- **Histórico** de tudo o que foi feito
- **IA**: com o Piphin LLM, a IA faz o check-up e, com a confirmação da pessoa, limpa, otimiza, desfaz, mexe na inicialização e liga o Modo Turbo

## Estrutura

`module/`: `backend.js` (orquestra), `junk.js` (categorias de lixo), `tweaks.js` (otimizações e desfazer), `startup.js` (inicialização e programas), `admin.js` (ajudante de administrador, um pedido UAC por vez), `sys.js` (registro, PowerShell, arquivos). `web/`: a tela.

```
npm run module
```
