# Catálogo de Eventos de Domínio

Este documento lista os eventos relevantes emitidos pelos módulos do domínio.

## Convenções

- Eventos devem representar fatos já ocorridos.
- O nome deve usar passado ou forma equivalente: `PartidaFinalizada`, `ContratoAssinado`, `JogadorLesionado`.
- Eventos não devem carregar detalhes internos desnecessários do módulo emissor.
- Consumidores devem ser capazes de reagir sem alterar a fonte de verdade do emissor.

## Eventos iniciais

| Evento | Emissor | Consumidores esperados | Status |
| --- | --- | --- | --- |
| PartidaFinalizada | Partidas | Competições, Histórico, Disciplina, Desenvolvimento, Finanças, Recordes, Mídias | A detalhar |
| ContratoAssinado | Contratos | Clubes, Histórico, Mídias | A detalhar |
| TransferenciaConcluida | Mercado | Contratos, Clubes, Histórico, Finanças, Mídias | A detalhar |
| DiaAvancado | Campanha | Agenda do domínio, Mídias, IA dos clubes | A detalhar |
| TemporadaEncerrada | Campanha | Competições, Desenvolvimento, Histórico, Finanças | A detalhar |

