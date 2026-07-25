# FuteVerso — regras de trabalho

Simulador de futebol 2D open source em TypeScript. O motor de partida vive em
`src/domain/match` (domínio puro, determinístico); a apresentação em `src/presentation`;
a orquestração em `src/application`.

**Contexto que motiva as regras abaixo:** muita coisa ainda vai mudar. O objetivo é
não deixar o desenvolvimento cada vez mais custoso — cada comentário, teste ou
acoplamento a mais é peso que atrasa a próxima mudança.

## Regra nº 1 — nada de gambiarra

Toda mudança que eu pedir começa por uma **análise da arquitetura atual**, não pela
solução mais rápida. Antes de escrever código, decida conscientemente entre:

- **Reformular** — quando o que existe está incoerente, com fórmula/caso especial
  cravado na mão, ou complexidade desnecessária. Prefira uma regra única e uniforme
  a três casos particulares. Reformular uma implementação suja é sempre permitido.
- **Adicionar** — quando a arquitetura comporta o novo comportamento sem distorção.
- **Adaptar** — só quando adaptar o que existe é genuinamente a opção mais limpa,
  não um atalho para evitar mexer no que precisa mudar.

Não são aceitáveis: gambiarra, remendo, caso especial para "fazer funcionar", número
mágico sem justificativa, nem duplicar lógica que já existe. Se a solução limpa exige
repensar uma parte, tudo bem — repense e explique o trade-off.

Ao entregar, diga em uma linha qual dos três caminhos escolheu e por quê.

## Regra nº 2 — o mínimo de comentários

Código auto-explicativo primeiro: nomes claros e funções pequenas valem mais que
comentário. Comente **só o porquê não-óbvio** — uma decisão contraintuitiva, uma
restrição externa, uma armadilha. Nunca comente o que o código já diz. Menos
comentário é menos coisa para envelhecer e mentir quando o código mudar.

## Regra nº 3 — o mínimo de testes, que não travem o desenvolvimento

Poucos testes, de alto valor: comportamento crítico do motor e regressões que doem.
Escreva o teste que falha se o bug voltar e confirme que ele discrimina o caminho
certo (não passa por um acidente, como um timeout no lugar da chegada real). **Não**
busque cobertura exaustiva nem teste detalhe de implementação — um teste rígido demais
trava a próxima refatoração. Rode `npm test` (Vitest) antes de dar por pronto; o
domínio é determinístico por semente, então regressões reais aparecem.

## Regra nº 4 — sempre soluções modulares

Prefira módulos coesos e de baixo acoplamento, cada regra do jogo em uma **fonte de
incumbência única**. Desconfie quando o mesmo conceito é recalculado em dois sistemas,
ou quando um módulo precisa conhecer as entranhas de outro — é sinal de reformulação.
Interfaces pequenas e explícitas entre domínio, aplicação e apresentação; o domínio
não importa apresentação. Modular é o que mantém a mudança barata.

## Convenções

- O pouco comentário que houver, e as mensagens, em português; nomes de código em
  inglês, como o existente.
- As "Regra N" citadas nos comentários do código referem-se às Leis do Futebol (IFAB)
  que o motor modela (saída de bola, impedimento, primeiro toque, etc.), não a este
  arquivo.
