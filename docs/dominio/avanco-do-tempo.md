# Avanço do Tempo

Este documento detalha o ciclo completo de avanço do tempo da campanha.

## Objetivo

Definir a ordem de execução dos módulos quando a data da campanha avança.

O avanço do tempo deve ser um caso de uso central.

```text
AvancarDia
  ↓
Atualizar data
  ↓
Publicar DiaAvancado
  ↓
Executar sistemas programados
```

## Estrutura diária inicial

1. Validar estado atual da campanha.
2. Executar agenda diária.
3. Processar partidas agendadas.
4. Aplicar eventos de desenvolvimento, desgaste e recuperação.
5. Processar mercado e IA dos clubes.
6. Atualizar notícias e histórico.
7. Persistir o novo estado da campanha.

## Rotinas diárias

- recuperação física;
- evolução de lesões;
- processamento de negociações;
- partidas;
- decisões da IA;
- vencimentos de tarefas.

## Rotinas semanais

- treinamento;
- avaliação de elenco;
- relatórios;
- planejamento.

## Rotinas mensais

- salários;
- finanças;
- desenvolvimento;
- reputação;
- clima sazonal.

## Fim de temporada

- encerramento de competições;
- promoções;
- rebaixamentos;
- premiações;
- aposentadorias;
- novas edições;
- geração de jogadores.

## Agenda do domínio

Eventos futuros devem ser representados explicitamente.

```ts
type TarefaAgendada = {
  id: string
  executarEm: string
  tipo: string
  referenciaId?: string
  payload: Record<string, unknown>
  status: 'pendente' | 'executada' | 'cancelada'
}
```

Evitar verificações de data espalhadas por vários módulos.

## Pendências

- Definir ordem exata dos módulos.
- Definir quais etapas são síncronas ou assíncronas.
- Definir como falhas parciais são tratadas.
- Definir quais eventos são emitidos em cada etapa.

