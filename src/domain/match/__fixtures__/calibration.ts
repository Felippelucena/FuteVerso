/**
 * Liga a suíte de calibragem/caracterização — as medidas de PARTIDA INTEIRA (fingerprint,
 * estamina, impedimento, estatística de simulação) que reafinam a cada mudança de regime do motor
 * e, por isso, ficam fora da suíte padrão enquanto o motor está em obra. Rode-as sob demanda:
 *
 *   PowerShell:  $env:CALIBRATE=1; npx vitest run
 *   bash:        CALIBRATE=1 npx vitest run
 *
 * Lê `process.env` via `globalThis` para não depender de `@types/node` (o domínio não usa Node).
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const CALIBRATION = env?.CALIBRATE === "1";

/**
 * Gate próprio para a medida de CUSTO (engine-budget). Separado de `CALIBRATE` porque é outra
 * natureza de medida: as de calibragem medem o jogo e sobrevivem a qualquer máquina; esta mede a
 * máquina, e a suíte inteira rodando em paralelo a infla em 2,5×. Roda sozinha:
 *
 *   PowerShell:  $env:BUDGET=1; npx vitest run src/domain/match/engine-budget.test.ts
 *   bash:        BUDGET=1 npx vitest run src/domain/match/engine-budget.test.ts
 */
export const BUDGET = env?.BUDGET === "1";

/**
 * Gate do **regime** (`match-regime.test.ts`): duas sementes, ~70 s, e devolve o retrato grosso do
 * jogo — onde a bola vive, quanto o portador avança, quantos chutes e gols saem.
 *
 * Existe separado de `CALIBRATE` porque serve a outro momento. A calibragem de oito sementes é para
 * **afinar número** e custa cinco minutos; esta é para **detectar quebra** entre uma fase de reforma e
 * a seguinte, quando afinar ainda seria trabalho jogado fora. Foi ela que separou artefato de defeito
 * na reforma do valor de posse, medindo o HEAD como controle com uma variável de diferença.
 *
 *   PowerShell:  $env:REGIME=1; npx vitest run match-regime
 *   bash:        REGIME=1 npx vitest run match-regime
 */
export const REGIME = env?.REGIME === "1";
