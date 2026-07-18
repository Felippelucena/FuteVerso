# Glossário do Domínio

Este glossário define os termos oficiais usados na documentação e no código do FuteVerso.

## Termos iniciais

| Termo | Definição |
| --- | --- |
| Conteúdo | Base editável usada para iniciar campanhas, contendo clubes, pessoas, competições, estádios, regras e demais dados de partida. |
| Campanha | Estado vivo de um jogo iniciado a partir de um snapshot do conteúdo. |
| Snapshot inicial | Cópia dos dados necessários para iniciar uma campanha sem depender de mudanças futuras no conteúdo editável. |
| Módulo | Unidade lógica do monólito modular, com responsabilidades e contratos públicos próprios. |
| Comando | Intenção explícita de alterar estado do domínio. |
| Consulta | Leitura de dados exposta por um módulo sem permitir alteração direta de seu estado interno. |
| Evento de domínio | Registro de algo relevante que aconteceu e pode ser consumido por outros módulos. |
| Fonte de verdade | Entidade, tabela ou módulo responsável por definir oficialmente uma informação. |
| Contrato | Vínculo formal entre pessoa e clube. |
| Inscrição | Registro que define elegibilidade de uma pessoa ou clube em uma competição. |
| Escalação | Definição dos participantes de uma partida. |
| Histórico | Registro de fatos já ocorridos dentro da campanha. |
| Seed | Valor usado para tornar processos aleatórios reprodutíveis. |

## Regras

- Um termo deve ter uma única definição oficial.
- Sinônimos devem apontar para o termo principal.
- Termos de interface só devem entrar aqui quando representarem conceitos do domínio.
