import type { Club } from "./model";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const FOUNDED_YEAR_RANGE = { minimum: 1800, maximum: 2100 } as const;

const isHexColor = (value: unknown): value is string => typeof value === "string" && HEX_COLOR.test(value);

export const isValidClub = (value: unknown): value is Club => {
  if (!value || typeof value !== "object") return false;
  const club = value as Club;
  return typeof club.id === "string"
    && club.id.length > 0
    && typeof club.name === "string"
    && club.name.trim().length > 0
    && typeof club.shortName === "string"
    && club.shortName.trim().length === 3
    && typeof club.nickname === "string"
    && typeof club.nationality === "string"
    && club.nationality.length === 2
    && typeof club.city === "string"
    && !!club.colors
    && isHexColor(club.colors.primary)
    && isHexColor(club.colors.secondary)
    && isHexColor(club.colors.text)
    && Number.isInteger(club.founded)
    && club.founded >= FOUNDED_YEAR_RANGE.minimum
    && club.founded <= FOUNDED_YEAR_RANGE.maximum
    && Number.isFinite(club.reputation)
    && club.reputation >= 1
    && club.reputation <= 100
    && !!club.defaultPlan
    && Array.isArray(club.defaultPlan.assignments);
};
