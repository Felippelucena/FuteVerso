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
