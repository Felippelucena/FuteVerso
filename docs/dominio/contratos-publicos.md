# Contratos Públicos Entre Módulos

Este documento registra a superfície pública que cada módulo pode expor para os demais.

## Modelo de contrato público

Cada contrato deve informar:

- módulo proprietário;
- nome do comando, consulta ou evento;
- dados de entrada;
- dados de saída;
- invariantes;
- erros esperados;
- consumidores conhecidos.

## Contratos iniciais a detalhar

| Módulo | Tipo | Nome | Status |
| --- | --- | --- | --- |
| Campanha | Comando | AvançarDia | A detalhar |
| Competições | Evento | PartidaFinalizada | A detalhar |
| Contratos | Consulta | ObterVinculoAtualDaPessoa | A detalhar |
| Clubes | Consulta | ObterElencoAtual | A detalhar |
| Partidas | Comando | SimularPartida | A detalhar |

