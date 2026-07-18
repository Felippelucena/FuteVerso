# FuteVerso — Diretrizes de Desenvolvimento

> Documento vivo de referência para arquitetura, domínio, regras e padrões de desenvolvimento do projeto FuteVerso.

Este arquivo é a porta de entrada da documentação. Os detalhes foram separados em documentos focados para manter a leitura, manutenção e evolução mais simples.

## 1. Objetivo do documento

Este documento estabelece a visão geral das diretrizes de desenvolvimento do FuteVerso e aponta para os documentos especializados.

Ele deve ajudar a localizar decisões sobre:

- arquitetura de software;
- divisão dos módulos;
- modelagem das entidades;
- integração entre sistemas;
- persistência;
- editor de conteúdo;
- campanhas e saves;
- simulador de partidas;
- evolução futura do projeto;
- decisões técnicas;
- testes e validação.

## 2. Princípios gerais

### 2.1 Monólito modular

O jogo será desenvolvido inicialmente como um monólito modular.

Cada módulo deve possuir responsabilidades bem definidas, expor uma interface pública, ocultar detalhes internos e comunicar-se por comandos, consultas e eventos internos.

Microsserviços não fazem parte da arquitetura inicial.

### 2.2 Domínio separado da interface

As regras do jogo não devem depender de framework de interface, renderização, banco de dados específico, plataforma de execução ou estrutura visual do editor.

O domínio deve poder ser testado e executado isoladamente.

### 2.3 Fonte única de verdade

Cada informação importante deve possuir uma fonte de verdade clara.

Exemplos:

- contrato define o vínculo entre pessoa e clube;
- inscrição define elegibilidade em uma competição;
- escalação define participação em uma partida;
- histórico registra fatos já ocorridos;
- idade é calculada a partir da data de nascimento e da data da campanha.

### 2.4 Evolução sem acoplamento excessivo

Novos sistemas devem ser adicionados, sempre que possível, como consumidores de eventos ou novos módulos, evitando alterações amplas no núcleo existente.

## 3. Mapa da documentação

### Arquitetura

- [Camadas da Aplicação](arquitetura/camadas.md)
- [Comunicação Entre Módulos](arquitetura/comunicacao-entre-modulos.md)
- [Dependências Entre Módulos](arquitetura/dependencias.md)
- [Modelos de Escrita e Leitura](arquitetura/modelos-escrita-leitura.md)
- [Persistência](arquitetura/persistencia.md)
- [Aleatoriedade e Reprodutibilidade](arquitetura/aleatoriedade-e-reprodutibilidade.md)
- [Estrutura de Código](arquitetura/estrutura-de-codigo.md)
- [Tipos Compartilhados](arquitetura/tipos-compartilhados.md)
- [Testes](arquitetura/testes.md)

### Domínio

- [Glossário do Domínio](dominio/glossario.md)
- [Módulos e Dependências](dominio/modulos.md)
- [Contratos Públicos Entre Módulos](dominio/contratos-publicos.md)
- [Catálogo de Eventos de Domínio](dominio/eventos.md)
- [IDs e Referências](dominio/ids-e-referencias.md)
- [Avanço do Tempo](dominio/avanco-do-tempo.md)

### Dados

- [Conteúdo e Campanha](dados/conteudo-e-campanha.md)
- [Banco de Conteúdo](dados/banco-conteudo.md)
- [Banco de Campanha](dados/banco-campanha.md)
- [Sistema de Mods](dados/mods.md)
- [Migração e Compatibilidade](dados/migracao-e-compatibilidade.md)

### Simulador

- [Arquitetura do Simulador](simulador/arquitetura.md)
- [Regras do Simulador](simulador/regras.md)
- [Calibração e Testes do Simulador](simulador/calibracao-e-testes.md)

### Planejamento e decisões

- [Questões em Aberto](planejamento/questoes-em-aberto.md)
- [Próximas Seções](planejamento/proximas-secoes.md)
- [ADRs](adr/README.md)

## 4. Regra de manutenção da documentação

Toda nova decisão deve responder:

1. qual problema está sendo resolvido;
2. qual módulo é responsável;
3. qual é a fonte de verdade;
4. quais eventos são emitidos;
5. quais módulos consomem esses eventos;
6. quais dados são persistidos;
7. quais invariantes precisam ser testados;
8. como a decisão afeta campanhas antigas;
9. como a decisão pode ser configurada ou modificada;
10. quais alternativas foram descartadas.

Quando a decisão for estrutural, ela deve ser registrada no documento focado correspondente ou em um ADR.
