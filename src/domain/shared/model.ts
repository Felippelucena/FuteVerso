export type Team = "blue" | "coral";

// Código ISO 3166-1 alpha-2 em maiúsculas ("BR", "AR", "PT"). O catálogo de países vive em
// content; o domínio só trata a nacionalidade como um identificador opaco.
export type CountryCode = string;

export interface Vec2 {
  x: number;
  y: number;
}
