# Questões em Aberto

Este documento concentra as decisões ainda pendentes do FuteVerso.

Cada questão deve sair daqui somente quando possuir uma decisão registrada no documento de referência correspondente ou em um ADR.

## Status possíveis

- `Em aberto`: ainda não existe decisão suficiente.
- `Em análise`: existem alternativas sendo avaliadas.
- `Decidido`: existe decisão registrada e aplicável.
- `Adiado`: a decisão não é necessária para a fase atual.

## Questões

| ID | Tema | Status | Decisão atual | Documento relacionado |
| --- | --- | --- | --- | --- |
| Q01 | Linguagem e runtime definitivos | Decidido | TypeScript como linguagem principal; domínio em TS puro e runtime web/desktop por adaptadores | [camadas](../arquitetura/camadas.md) |
| Q02 | Framework da interface | Decidido | Vite + React + TypeScript + Zod + Tailwind | [camadas](../arquitetura/camadas.md) |
| Q03 | Formato final de distribuição | Decidido | Web app local/PWA como base e distribuição desktop com Tauri; Electron apenas como alternativa de contingência | [camadas](../arquitetura/camadas.md) |
| Q04 | Estratégia exata de mods | Decidido | Mods declarativos em pacotes versionados, validados por schemas Zod e aplicados sobre o banco de conteúdo | [mods](../dados/mods.md) |
| Q05 | Resolução de conflitos entre pacotes | Decidido | Ordem determinística de carregamento, validação prévia e relatório explícito de conflitos antes da campanha | [mods](../dados/mods.md) |
| Q06 | Esquema de IDs | Em aberto | A definir | [IDs e referências](../dominio/ids-e-referencias.md) |
| Q07 | Formato das regras editáveis | Em aberto | A definir | [banco de conteúdo](../dados/banco-conteudo.md) |
| Q08 | Estrutura definitiva do simulador | Em aberto | A definir | [arquitetura do simulador](../simulador/arquitetura.md) |
| Q09 | Modelo financeiro | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q10 | Profundidade da comissão técnica | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q11 | Seleções nacionais | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q12 | Categorias de base | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q13 | Calendário internacional | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q14 | Sistema de reputação | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q15 | Sistema de objetivos | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q16 | Sistema de notícias | Em aberto | A definir | [módulos](../dominio/modulos.md) |
| Q17 | Multiplayer ou compartilhamento de campanhas | Em aberto | A definir | [camadas](../arquitetura/camadas.md) |

## Como responder uma questão

Ao responder uma questão, registrar:

1. contexto do problema;
2. decisão tomada;
3. alternativas consideradas;
4. impacto nos módulos;
5. impacto em persistência e compatibilidade;
6. documento ou ADR onde a decisão ficou formalizada.
