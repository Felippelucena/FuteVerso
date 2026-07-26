/**
 * Trecho de tela reconstruído só quando muda a assinatura das suas entradas. A assinatura é
 * calculada antes da marcação, então montar a string também é evitado.
 */
export class Section {
  private signature: string | null = null;

  constructor(private readonly apply: () => void) {}

  update(signature: string): void {
    if (signature === this.signature) return;
    this.signature = signature;
    this.apply();
  }
}
