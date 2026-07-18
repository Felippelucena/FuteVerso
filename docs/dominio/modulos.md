# Módulos e Dependências

Este documento descreve os módulos do domínio, suas responsabilidades e suas fronteiras.

## Módulos principais

Estrutura inicial:

```text
conteudo
campanha
mundo
pessoas
clubes
competicoes
mercado
desenvolvimento
partidas
historico
midias
```

Cada módulo deve possuir:

- entidades;
- objetos de valor;
- serviços de domínio;
- casos de uso;
- repositórios;
- eventos públicos;
- contratos públicos;
- testes.

## Visão geral

| Módulo | Responsabilidade | Fonte de verdade principal |
| --- | --- | --- |
| Conteúdo | Manter dados editáveis usados como base para campanhas. | Banco de conteúdo |
| Campanha | Controlar estado vivo da campanha. | Banco de campanha |
| Pessoas | Representar jogadores, técnicos, dirigentes e demais pessoas. | Pessoa e atributos derivados |
| Contratos | Controlar vínculos formais entre pessoas e clubes. | Contrato |
| Clubes | Representar clubes, estrutura, reputação e identidade institucional. | Clube |
| Mundo | Representar países, regiões, calendário e ambiente externo. | País, cidade, calendário |
| Estádios | Representar estádios e suas características. | Estádio |
| Competições | Controlar competições, edições, fases e regras. | Competição, edição, fase |
| Partidas | Controlar preparação, execução e resultado de partidas. | Partida |
| Mercado | Controlar transferências, empréstimos e negociações. | Proposta e transferência |
| IA dos clubes | Decidir ações de clubes controlados pelo sistema. | Política interna do módulo |
| Desenvolvimento | Controlar evolução e regressão de jogadores. | Histórico de desenvolvimento |
| Histórico | Registrar fatos consolidados da campanha. | Evento histórico |
| Mídias | Gerar notícias e mensagens derivadas de fatos do domínio. | Evento consumido |

## Regra geral de dependência

Módulos não devem acessar diretamente tabelas internas de outros módulos.

A comunicação deve ocorrer por:

- comandos;
- consultas;
- eventos de domínio;
- contratos públicos documentados.

As regras detalhadas de dependência ficam em [Dependências Entre Módulos](../arquitetura/dependencias.md).

## Conteúdo

Responsabilidades:

- CRUD de definições;
- validação;
- importação;
- exportação;
- resolução de conflitos entre mods;
- versionamento;
- consolidação do conteúdo;
- geração do snapshot inicial.

Não é responsabilidade deste módulo:

- simular partidas;
- processar transferências;
- evoluir jogadores;
- atualizar classificações;
- executar IA de clubes.

## Campanha

Responsabilidades:

- criar, carregar e salvar campanhas;
- controlar a data atual;
- controlar a seed aleatória;
- avançar o calendário;
- executar tarefas programadas;
- iniciar e encerrar temporadas;
- coordenar sistemas diários, semanais, mensais e sazonais;
- controlar migrações do save.

A campanha coordena os módulos, mas não concentra todas as regras.

## Pessoas

A identidade básica deve ser separada das funções profissionais.

```text
Pessoa
├── Jogador
├── Técnico
└── Membro de comissão
```

Sugestão:

```ts
type Pessoa = {
  id: string
  nome: string
  dataNascimento: string
  nacionalidadeId: string
  reputacao: number
  statusCarreira: string
}
```

Especializações:

```ts
type Jogador = {
  pessoaId: string
  posicoes: string[]
  atributos: Record<string, number>
  desenvolvimento: EstadoDesenvolvimento
}

type Tecnico = {
  pessoaId: string
  atributos: Record<string, number>
  preferenciasTaticas: PreferenciasTaticas
}

type MembroComissao = {
  pessoaId: string
  especialidade: string
  atributos: Record<string, number>
}
```

Evitar uma entidade única com todos os campos possíveis.

## Contratos

Contratos devem ser entidades próprias.

```ts
type Contrato = {
  id: string
  pessoaId: string
  clubeId: string

  funcao: string

  inicio: string
  fim: string

  salario: Dinheiro
  bonus: BonusContrato[]

  tipo: 'permanente' | 'emprestimo' | 'temporario'

  status:
    | 'proposto'
    | 'ativo'
    | 'encerrado'
    | 'rescindido'
}
```

O contrato deve ser a fonte de verdade do vínculo entre pessoa e clube.

Isso permite:

- transferências;
- empréstimos;
- contratos futuros;
- períodos sem clube;
- rescisões;
- múltiplas funções;
- históricos de carreira.

## Clubes

O clube deve ser uma entidade central, porém não deve concentrar todos os sistemas.

```text
Clube
├── identidade
├── reputação
├── finanças
├── instalações
├── planejamento esportivo
├── elenco
├── comissão técnica
├── estádio
└── inscrições
```

Possíveis estados separados:

```ts
type FinancasClube = {
  clubeId: string
  saldo: Dinheiro
  folhaSalarial: Dinheiro
  orcamentoTransferencias: Dinheiro
}

type EstruturaClube = {
  clubeId: string
  nivelTreinamento: number
  nivelJuvenil: number
  nivelMedico: number
  nivelOlheiros: number
}

type EstrategiaClube = {
  clubeId: string
  perfilContratacoes: string[]
  prioridadeBase: number
  toleranciaFinanceira: number
  expectativaTemporada: string
}
```

## Elenco, vínculo e elegibilidade

Separar:

```text
Contrato
  define vínculo trabalhista

Inscrição
  define elegibilidade em uma competição

Disponibilidade
  define se o jogador pode atuar

Escalação
  define participação em uma partida
```

Um jogador pode ter contrato com um clube e não estar inscrito em determinada competição.

## Mundo

Responsabilidades:

- países;
- regiões;
- cidades;
- localizações;
- calendário;
- estações;
- perfis climáticos;
- condições climáticas.

### Clima

Separar:

- perfil climático;
- condição climática;
- clima da partida.

O perfil climático pertence à localização.

A condição climática é gerada para uma data.

O clima da partida é um snapshot persistido no contexto da partida.

## Estádios

O estádio deve ser uma entidade própria.

```ts
type Estadio = {
  id: string
  nome: string
  cidadeId: string

  capacidade: number
  tipoGramado: string
  cobertura: number

  qualidadeGramado: number
  drenagem: number
  iluminacao: number
}
```

A relação entre clube e estádio deve permitir:

- propriedade;
- uso como mandante;
- compartilhamento;
- uso temporário;
- campo neutro;
- reformas.

## Competições

Separar:

```text
Organização
  ↓ organiza
Competição
  ↓ instancia
Edição
  ↓ contém
Fases
  ↓ geram
Partidas
```

### Competição

É a definição permanente.

Exemplos:

- Campeonato Brasileiro Série A;
- Copa do Brasil;
- Copa Libertadores.

### Edição

É a realização em uma temporada específica.

Exemplo:

- Campeonato Brasileiro Série A 2028.

### Fase

É uma parte da edição.

Exemplos:

- fase de grupos;
- oitavas;
- quartas;
- semifinal;
- final.

### Regras

As regras devem ser compostas, evitando formatos fixos codificados diretamente.

```ts
type RegrasCompeticao = {
  formato: FormatoCompeticao
  pontuacao: RegraPontuacao
  desempate: CriterioDesempate[]
  substituicoes: RegraSubstituicoes
  inscricao: RegraInscricao
  suspensoes: RegraSuspensao
  classificacao: RegraClassificacao
}
```

## Partidas

A partida deve ser uma fronteira clara.

O simulador recebe um contexto imutável:

```ts
type ContextoPartida = {
  partidaId: string
  data: string

  mandante: ContextoEquipePartida
  visitante: ContextoEquipePartida

  estadio: ContextoEstadio
  clima: ClimaPartida

  competicao: ContextoCompeticao
  arbitragem: ContextoArbitragem

  seed: string
}
```

O simulador devolve um relatório:

```ts
type RelatorioPartida = {
  partidaId: string

  placar: Placar
  eventos: EventoPartida[]
  estatisticas: EstatisticasPartida

  participacoes: ParticipacaoJogador[]
  alteracoesFisicas: AlteracaoFisica[]
  alteracoesDisciplinares: AlteracaoDisciplinar[]

  seed: string
  versaoSimulador: string
}
```

O simulador não deve atualizar diretamente:

- classificação;
- contratos;
- histórico;
- suspensões;
- finanças;
- recordes.

Ele apenas relata o que ocorreu.

Mais detalhes ficam em [Arquitetura do Simulador](../simulador/arquitetura.md).

## Mercado

Responsabilidades:

- interesse;
- observação;
- propostas;
- negociações;
- contratos;
- transferências;
- empréstimos;
- disponibilidade no mercado.

A transferência deve ser uma entidade confirmada, não uma simples alteração de `clubeId`.

Fluxo:

```text
Interesse
  ↓
Proposta
  ↓
Negociação com clube
  ↓
Negociação contratual
  ↓
Transferência
  ↓
Encerramento e criação de contratos
```

## IA dos clubes

A IA deve produzir intenções e comandos válidos.

```text
Estado do clube
  ↓
Avaliação da IA
  ↓
Intenção
  ↓
Comando de domínio
  ↓
Validação
  ↓
Execução
```

A IA não deve:

- acessar tabelas diretamente;
- ignorar regras;
- alterar estados arbitrariamente;
- possuir caminhos exclusivos para executar ações.

Usuário e IA devem utilizar os mesmos casos de uso.

## Desenvolvimento de jogadores

Responsabilidades:

- envelhecimento;
- progressão;
- regressão;
- treinamento;
- potencial;
- experiência;
- condição física;
- lesões;
- aposentadoria.

A idade deve ser calculada:

```text
idade = data atual da campanha - data de nascimento
```

A progressão deve considerar múltiplos fatores:

- idade;
- potencial;
- minutos;
- treino;
- nível da competição;
- comissão técnica;
- instalações;
- lesões;
- personalidade;
- atributos atuais.

Alterações relevantes devem produzir registros históricos.

## Novos jogadores

Jogadores gerados durante a campanha devem usar o mesmo modelo dos jogadores importados.

Após a criação, nenhum sistema deve precisar saber se o jogador:

- veio do editor;
- veio de um mod;
- foi gerado pela base;
- foi criado como reposição mundial.

A origem deve ser metadado, não um comportamento estrutural diferente.

## Histórico

O histórico deve registrar fatos ocorridos no mundo.

Exemplos:

- estreias;
- transferências;
- títulos;
- premiações;
- aposentadorias;
- recordes;
- temporadas;
- passagens por clubes;
- evolução de atributos.

Evitar guardar todo o histórico dentro de campos JSON das entidades.

Usar:

- fatos históricos;
- estatísticas agregadas;
- projeções para consultas rápidas.

## Mídias

Mídias devem ser armazenadas em um registro central.

Exemplos:

- escudos;
- fotos;
- uniformes;
- bandeiras;
- estádios;
- troféus.

Entidades devem armazenar apenas referências de mídia.

Isso permite alterar o armazenamento sem modificar o domínio.

## Pendências

- Definir dependências permitidas módulo a módulo.
- Separar módulos obrigatórios de módulos opcionais.
- Definir quais módulos participam do ciclo diário, semanal, mensal e de fim de temporada.

