# Comunicação Entre Módulos

Este documento define como módulos se comunicam dentro do monólito modular.

## Formas principais

- comandos para solicitar mudanças;
- consultas para leitura controlada;
- eventos para propagação de fatos ocorridos.

## Comandos

Comandos representam uma intenção.

Exemplos:

- `AvancarDia`;
- `SimularPartida`;
- `EnviarProposta`;
- `ContratarJogador`;
- `InscreverJogador`.

Um comando pode falhar ou ser recusado.

## Eventos

Eventos representam fatos que já aconteceram.

Exemplos:

- `DiaAvancado`;
- `JogadorTransferido`;
- `ContratoAssinado`;
- `PartidaFinalizada`;
- `CompeticaoEncerrada`;
- `JogadorAposentado`.

Eventos devem ser consumidos sem exigir acesso aos detalhes internos do módulo emissor.

## Consultas

Consultas apenas leem informações.

Exemplos:

- `ObterElencoDoClube`;
- `ObterClassificacao`;
- `ObterHistoricoDoJogador`;
- `ObterPartidasDoDia`.

Consultas não devem modificar o estado.

## Pendências

- Definir padrão de nomenclatura.
- Definir envelope de eventos.
- Definir rastreabilidade entre comando, evento e mudança persistida.

