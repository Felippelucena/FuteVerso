# Camadas da Aplicação

Este documento detalha as camadas da aplicação e concentra decisões de runtime, interface e distribuição.

## Questões relacionadas

- [Q01 - Linguagem e runtime definitivos](../planejamento/questoes-em-aberto.md)
- [Q02 - Framework da interface](../planejamento/questoes-em-aberto.md)
- [Q03 - Formato final de distribuição](../planejamento/questoes-em-aberto.md)
- [Q17 - Multiplayer ou compartilhamento de campanhas](../planejamento/questoes-em-aberto.md)

## Princípio atual

O domínio deve permanecer independente de interface, banco de dados específico e plataforma de execução.

As regras do jogo não devem depender de:

- framework de interface;
- renderização;
- banco de dados específico;
- plataforma de execução;
- estrutura visual do editor.

## Decisões de stack

Estas decisões respondem Q01, Q02 e Q03.

### Linguagem e runtime

TypeScript é a linguagem principal do projeto.

O domínio deve ser implementado em TypeScript puro, sem dependência direta de React, Vite, APIs de navegador, Tauri, Electron, IndexedDB, SQLite ou qualquer framework de interface.

O runtime padrão de desenvolvimento será o ambiente web fornecido por Vite. Runtimes específicos, como navegador, PWA ou desktop, devem entrar pelas camadas de interface e infraestrutura.

### Interface

A interface oficial será construída com:

- Vite;
- React;
- TypeScript;
- Zod;
- Tailwind.

Bibliotecas auxiliares recomendadas para a interface:

- shadcn/ui, Radix UI e lucide-react para componentes, primitivas acessíveis e ícones;
- React Hook Form integrado a Zod para formulários;
- TanStack Table para tabelas e datagrids;
- TanStack Virtual para listas extensas;
- Recharts para gráficos;
- dnd-kit para drag and drop;
- Zustand ou Jotai para estado local de interface.

Essas bibliotecas não devem atravessar a fronteira do domínio.

### Distribuição

O formato base será web app local/PWA, com distribuição desktop por Tauri.

Tauri é a escolha preferencial para executáveis desktop por permitir reaproveitar a interface web, gerar aplicações multiplataforma e manter uma camada nativa pequena para arquivos, banco local e integrações de sistema.

Electron fica definido como alternativa de contingência, caso algum requisito futuro exija integração Node/Chromium mais ampla que a oferecida por Tauri.

O jogo não deve depender de uma decisão irreversível entre web e desktop. A camada de aplicação deve conversar com portas, e cada runtime deve fornecer seus adaptadores.

## Estrutura em camadas

```text
interfaces
  jogo, editor, telas, importadores, ferramentas
      ↓
aplicação
  casos de uso, comandos, consultas, orquestração
      ↓
domínio
  pessoas, clubes, competições, mercado, partidas,
  desenvolvimento, mundo, histórico, regras
      ↓
infraestrutura
  SQLite, arquivos, mídias, RNG, logs, migrações
```

## Responsabilidades

| Camada | Responsabilidade |
| --- | --- |
| Interfaces | Expor fluxos para usuário, editor, importadores e ferramentas. |
| Aplicação | Orquestrar casos de uso, comandos, consultas e transações. |
| Domínio | Concentrar regras do jogo e invariantes. |
| Infraestrutura | Implementar persistência, arquivos, logs, RNG e integrações técnicas. |

## Diretriz

A dependência deve apontar para dentro: interfaces dependem da aplicação, aplicação coordena domínio, e infraestrutura implementa portas necessárias sem definir regras do jogo.
