# Checklist de caracterização da interface

Use este roteiro antes e depois de mudanças estruturais na apresentação. O objetivo é detectar regressões sem transformar detalhes internos do DOM em contrato permanente.

## Navegação e partida

- [ ] Alternar entre `Partida` e `Jogadores` preserva a partida em andamento.
- [ ] Pausar impede novos ticks e altera o controle para continuar.
- [ ] As velocidades `0.5x`, `1x`, `2x`, `4x` e `8x` podem ser selecionadas.
- [ ] Reiniciar zera relógio, placar e estado transitório sem alterar pausa ou velocidade.
- [ ] Abas de inspetor, tática e análise continuam alternando seu conteúdo.

## Configurações

- [ ] Abrir e fechar o dialog funciona pelos botões de desktop e compacto.
- [ ] Aplicar uma seed válida reinicia uma partida reproduzível e persiste o valor.
- [ ] Gerar seed aleatória atualiza o campo e inicia outra partida.
- [ ] Habilitar ou desabilitar aprendizado é persistido.
- [ ] Restaurar memórias mantém o elenco e reinicia a partida.

## Jogadores e escalações

- [ ] As duas escalações exibem quatro participantes e permitem trocas válidas.
- [ ] Criar jogador atualiza imediatamente a lista e a contagem.
- [ ] Editar jogador preserva estatísticas e recalibra memória quando aplicável.
- [ ] Excluir jogador fora das escalações exige confirmação e remove sua memória.
- [ ] Excluir jogador escalado apresenta o erro atual e não altera o perfil.
- [ ] Mudanças salvas no perfil só alteram os participantes da partida após reiniciar.

## Persistência e layout

- [ ] Recarregar a página restaura perfil, escalações, seed, aprendizado e memórias.
- [ ] A aplicação salva o progresso automaticamente a cada cinco segundos.
- [ ] Ocultar a página dispara a persistência do progresso atual.
- [ ] Redimensionar a janela recalcula o Canvas sem distorcer o campo.
- [ ] Ícones, dialogs, placar, eventos e textos visíveis permanecem consistentes nas duas telas.
