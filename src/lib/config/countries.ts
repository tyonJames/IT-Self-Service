/**
 * Country codes, colours and normalisation.
 *
 * Radx uses "GR" (the Griffin entity) for South Africa rather than the ISO
 * "ZA". The ticket model historically accepted "ZA", so input is normalised
 * to "GR" at every service boundary and only "GR" is ever persisted — see
 * spec note 10 and CC-003.
 */

export const COUNTRY_CODES = ["ZW", "MZ", "GR", "NA"] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

/** Codes accepted on tickets and equipment requests, which allow "OTHER". */
export const TICKET_COUNTRY_CODES = [...COUNTRY_CODES, "OTHER"] as const;
export type TicketCountryCode = (typeof TICKET_COUNTRY_CODES)[number];

/** "ALL" is valid on a UserProfile (a group-wide agent), never on a record. */
export const PROFILE_COUNTRY_CODES = [...COUNTRY_CODES, "ALL"] as const;

export const COUNTRY_NAMES: Record<string, string> = {
  ZW: "Zimbabwe",
  MZ: "Mozambique",
  GR: "South Africa",
  NA: "Namibia",
  OTHER: "Other",
  ALL: "All countries",
};

/** Spec §1 — the accent colour used on tiles, list borders and badges. */
export const COUNTRY_COLOURS: Record<string, string> = {
  ZW: "#2d7a45",
  MZ: "#d4a017",
  GR: "#1a73e8",
  NA: "#e85d1a",
  OTHER: "#6c757d",
  ALL: "#2d7a45",
};

const ALIASES: Record<string, string> = {
  ZA: "GR",
  RSA: "GR",
  "SOUTH AFRICA": "GR",
  SA: "GR",
  ZIM: "ZW",
  ZIMBABWE: "ZW",
  MOZ: "MZ",
  MOZAMBIQUE: "MZ",
  NAM: "NA",
  NAMIBIA: "NA",
  GRIFFIN: "GR",
};

/**
 * Canonicalise anything a form, CSV or legacy row might contain.
 * Unknown values fall back to `fallback` so a bad import cannot introduce a
 * fifth colour into the palette.
 */
export function normaliseCountryCode(raw: string | null | undefined, fallback = "ZW"): string {
  if (!raw) return fallback;
  const upper = raw.trim().toUpperCase();
  if (upper === "") return fallback;
  if (upper === "OTHER" || upper === "ALL") return upper;
  const aliased = ALIASES[upper] ?? upper;
  return (COUNTRY_CODES as readonly string[]).includes(aliased) ? aliased : fallback;
}

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  const c = code.toUpperCase();
  return COUNTRY_NAMES[c] ?? c;
}

export function countryColour(code: string | null | undefined): string {
  if (!code) return COUNTRY_COLOURS.OTHER!;
  return COUNTRY_COLOURS[code.toUpperCase()] ?? COUNTRY_COLOURS.OTHER!;
}

/**
 * CSS custom properties injected once in the root layout so that components
 * can use `var(--country-ZW)` instead of inlining hex values — the Next.js
 * equivalent of the `country_palette` context processor.
 */
export function countryPaletteCss(): string {
  const vars = Object.entries(COUNTRY_COLOURS)
    .map(([code, colour]) => `--country-${code}: ${colour};`)
    .join(" ");
  return `:root { ${vars} }`;
}
