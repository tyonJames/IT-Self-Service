import type { AssetCategory } from "@prisma/client";
import { countryName } from "@/lib/config/countries";
import { ASSET_CATEGORY_LABELS } from "./assets";

/**
 * Asset tag decoding (spec §3.4).
 *
 *   RDX-ZL001  → Z = Zimbabwe, L = Laptop, sequence 001
 *   RDX-MP001  → M = Mozambique, P = Printer
 *
 * The system never *generates* a tag. Tags are assigned by the business and
 * typed in; all this module does is read one back and report whether it agrees
 * with the record it is attached to, which is what the data-health page shows.
 */

/** Country letter → country code. "S" is South Africa, whose code is GR. */
export const TAG_COUNTRY_LETTERS: Record<string, string> = {
  Z: "ZW",
  M: "MZ",
  S: "GR",
  N: "NA",
};

/** Type letter → asset category. Note M is Monitor here and Mozambique above:
 *  position disambiguates them, which is why the letters are not one map. */
export const TAG_TYPE_LETTERS: Record<string, AssetCategory> = {
  L: "laptop",
  D: "desktop",
  P: "printer",
  M: "monitor",
  C: "clocking",
  S: "starlink",
  T: "phone",
};

export const COUNTRY_TO_TAG_LETTER: Record<string, string> = {
  ZW: "Z",
  MZ: "M",
  GR: "S",
  NA: "N",
};

export const CATEGORY_TO_TAG_LETTER: Partial<Record<AssetCategory, string>> = {
  laptop: "L",
  desktop: "D",
  printer: "P",
  monitor: "M",
  clocking: "C",
  starlink: "S",
  phone: "T",
};

export interface DecodedAssetTag {
  raw: string;
  valid: boolean;
  countryCode: string | null;
  category: AssetCategory | null;
  sequence: number | null;
}

const TAG_PATTERN = /^RDX-([A-Z])([A-Z])(\d{1,6})$/i;

export function decodeAssetTag(tag: string | null | undefined): DecodedAssetTag | null {
  if (!tag) return null;
  const raw = tag.trim().toUpperCase();
  const match = TAG_PATTERN.exec(raw);
  if (!match) {
    return { raw, valid: false, countryCode: null, category: null, sequence: null };
  }

  const [, countryLetter, typeLetter, seq] = match as unknown as [string, string, string, string];
  const countryCode = TAG_COUNTRY_LETTERS[countryLetter] ?? null;
  const category = TAG_TYPE_LETTERS[typeLetter] ?? null;

  return {
    raw,
    valid: countryCode !== null && category !== null,
    countryCode,
    category,
    sequence: Number.parseInt(seq, 10),
  };
}

/**
 * Compare a tag against the record it is on and describe any discrepancy in
 * plain English, or return null when everything agrees (spec §3.4).
 */
export function tagMismatch(asset: {
  assetTag: string | null;
  site: string;
  category: AssetCategory;
}): string | null {
  if (!asset.assetTag) return null;

  const decoded = decodeAssetTag(asset.assetTag);
  if (!decoded) return null;

  if (!decoded.valid) {
    return `Tag “${decoded.raw}” does not follow the RDX-<country><type><number> scheme.`;
  }

  const problems: string[] = [];

  if (decoded.countryCode && decoded.countryCode !== asset.site) {
    problems.push(
      `tag says ${countryName(decoded.countryCode)} but the record is ${countryName(asset.site)}`,
    );
  }

  if (decoded.category && decoded.category !== asset.category) {
    // A legacy "computer" record tagged as a laptop or desktop is expected,
    // not a discrepancy worth chasing.
    const legacyComputerOk =
      asset.category === "computer" && (decoded.category === "laptop" || decoded.category === "desktop");
    if (!legacyComputerOk) {
      problems.push(
        `tag says ${ASSET_CATEGORY_LABELS[decoded.category]} but the record is ${ASSET_CATEGORY_LABELS[asset.category]}`,
      );
    }
  }

  if (problems.length === 0) return null;
  return `Tag mismatch: ${problems.join("; ")}.`;
}

/**
 * The tag this asset *would* have under the scheme — shown as a hint next to a
 * mismatch. Never written to the record: tags are business-assigned (spec §3.4).
 */
export function expectedTagPrefix(asset: { site: string; category: AssetCategory }): string | null {
  const countryLetter = COUNTRY_TO_TAG_LETTER[asset.site];
  const typeLetter = CATEGORY_TO_TAG_LETTER[asset.category];
  if (!countryLetter || !typeLetter) return null;
  return `RDX-${countryLetter}${typeLetter}`;
}

/** Normalise user input: trim, upper-case, and turn blank into NULL (spec note 6). */
export function normaliseAssetTag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}
