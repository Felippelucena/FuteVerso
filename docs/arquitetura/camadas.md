# Camadas da Aplicação

Este documento detalha as camadas da aplicação e concentra decisões de runtime, interface e distribuição.


## Princípio atual

O domínio deve permanecer independente de interface, banco de dados específico e plataforma de execução.

As regras do jogo não devem depender de:

- framework de interface;
- renderização;
- banco de dados específico;
- plataforma de execução;
- estrutura visual do editor.

## Decisões de stack

### Linguagem e runtime

TypeScript é a linguagem principal do projeto.

O domínio deve ser implementado em TypeScript puro, sem dependência direta de React, Vite, APIs de navegador, Tauri, IndexedDB, SQLite ou qualquer framework de interface.

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

O alvo principal de distribuição será Windows desktop por Tauri.

O formato base de desenvolvimento continuará sendo web app local, executado por Vite, para acelerar prototipação e testes de interface. A entrega oficial do jogo, porém, deve considerar desde o início um aplicativo instalável no Windows.

Tauri é a escolha preferencial para executáveis desktop por permitir reaproveitar a interface web, gerar aplicações multiplataforma e manter uma camada nativa pequena para arquivos, banco local e integrações de sistema.

Android e iOS são alvos futuros viáveis por Tauri, mas não devem conduzir a arquitetura inicial. O custo principal para mobile não está na persistência ou no empacotamento, e sim na adaptação de UX para telas pequenas, navegação por toque, tabelas extensas, editor de conteúdo e importação de pacotes.

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
