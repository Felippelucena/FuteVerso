import type { CountryCode } from "../domain/shared/model";

export type Region =
  | "América do Sul"
  | "América do Norte"
  | "Europa"
  | "África"
  | "Ásia"
  | "Oceania";

export interface Country {
  code: CountryCode;
  name: string;
  region: Region;
}

/**
 * Nacionalidades selecionáveis para jogadores e clubes. Independe das listas de nomes em
 * content/names: um país pode existir aqui sem ter arquivo de nomes, e nesse caso o gerador
 * empresta nomes de outros países (ver names/index.ts).
 */
export const COUNTRIES: readonly Country[] = [
  { code: "BR", name: "Brasil", region: "América do Sul" },
  { code: "AR", name: "Argentina", region: "América do Sul" },
  { code: "UY", name: "Uruguai", region: "América do Sul" },
  { code: "CL", name: "Chile", region: "América do Sul" },
  { code: "CO", name: "Colômbia", region: "América do Sul" },
  { code: "PE", name: "Peru", region: "América do Sul" },
  { code: "PY", name: "Paraguai", region: "América do Sul" },
  { code: "EC", name: "Equador", region: "América do Sul" },
  { code: "BO", name: "Bolívia", region: "América do Sul" },
  { code: "VE", name: "Venezuela", region: "América do Sul" },

  { code: "MX", name: "México", region: "América do Norte" },
  { code: "US", name: "Estados Unidos", region: "América do Norte" },
  { code: "CA", name: "Canadá", region: "América do Norte" },
  { code: "CR", name: "Costa Rica", region: "América do Norte" },

  { code: "PT", name: "Portugal", region: "Europa" },
  { code: "ES", name: "Espanha", region: "Europa" },
  { code: "IT", name: "Itália", region: "Europa" },
  { code: "FR", name: "França", region: "Europa" },
  { code: "DE", name: "Alemanha", region: "Europa" },
  { code: "GB", name: "Inglaterra", region: "Europa" },
  { code: "NL", name: "Países Baixos", region: "Europa" },
  { code: "BE", name: "Bélgica", region: "Europa" },
  { code: "HR", name: "Croácia", region: "Europa" },
  { code: "RS", name: "Sérvia", region: "Europa" },
  { code: "PL", name: "Polônia", region: "Europa" },
  { code: "DK", name: "Dinamarca", region: "Europa" },
  { code: "SE", name: "Suécia", region: "Europa" },
  { code: "NO", name: "Noruega", region: "Europa" },
  { code: "CH", name: "Suíça", region: "Europa" },
  { code: "AT", name: "Áustria", region: "Europa" },
  { code: "UA", name: "Ucrânia", region: "Europa" },
  { code: "GR", name: "Grécia", region: "Europa" },
  { code: "TR", name: "Turquia", region: "Europa" },

  { code: "MA", name: "Marrocos", region: "África" },
  { code: "SN", name: "Senegal", region: "África" },
  { code: "NG", name: "Nigéria", region: "África" },
  { code: "GH", name: "Gana", region: "África" },
  { code: "CI", name: "Costa do Marfim", region: "África" },
  { code: "CM", name: "Camarões", region: "África" },
  { code: "EG", name: "Egito", region: "África" },
  { code: "AO", name: "Angola", region: "África" },

  { code: "JP", name: "Japão", region: "Ásia" },
  { code: "KR", name: "Coreia do Sul", region: "Ásia" },
  { code: "SA", name: "Arábia Saudita", region: "Ásia" },
  { code: "QA", name: "Catar", region: "Ásia" },
  { code: "IR", name: "Irã", region: "Ásia" },

  { code: "AU", name: "Austrália", region: "Oceania" },
  { code: "NZ", name: "Nova Zelândia", region: "Oceania" },
];

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

export const findCountry = (code: CountryCode): Country | null => BY_CODE.get(code) ?? null;

export const countryName = (code: CountryCode): string => BY_CODE.get(code)?.name ?? code;

export const isKnownCountry = (code: string): boolean => BY_CODE.has(code);
