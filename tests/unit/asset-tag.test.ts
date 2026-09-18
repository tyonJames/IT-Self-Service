import { describe, expect, it } from "vitest";
import {
  decodeAssetTag,
  expectedTagPrefix,
  normaliseAssetTag,
  tagMismatch,
} from "@/lib/domain/asset-tag";
import { repairRecommendation, isSiteCategory, initialsOf } from "@/lib/domain/assets";

describe("decodeAssetTag", () => {
  it("decodes the examples from the specification", () => {
    expect(decodeAssetTag("RDX-ZL001")).toEqual({
      raw: "RDX-ZL001",
      valid: true,
      countryCode: "ZW",
      category: "laptop",
      sequence: 1,
    });

    expect(decodeAssetTag("RDX-ZD001")).toMatchObject({ countryCode: "ZW", category: "desktop" });
    expect(decodeAssetTag("RDX-MP001")).toMatchObject({ countryCode: "MZ", category: "printer" });
  });

  it("maps S to South Africa, whose code is GR (spec note 10)", () => {
    expect(decodeAssetTag("RDX-SL042")).toMatchObject({ countryCode: "GR", category: "laptop" });
  });

  it("reads M as Monitor in the type position and Mozambique in the country position", () => {
    // The same letter, disambiguated purely by position.
    expect(decodeAssetTag("RDX-MM007")).toMatchObject({
      countryCode: "MZ",
      category: "monitor",
    });
  });

  it("is case-insensitive and trims", () => {
    expect(decodeAssetTag("  rdx-nl003 ")).toMatchObject({
      raw: "RDX-NL003",
      countryCode: "NA",
      category: "laptop",
      sequence: 3,
    });
  });

  it("marks a tag that does not fit the scheme as invalid rather than throwing", () => {
    expect(decodeAssetTag("LAPTOP-7")).toMatchObject({ valid: false, countryCode: null });
    expect(decodeAssetTag("RDX-XX001")).toMatchObject({ valid: false });
  });

  it("returns null for no tag at all", () => {
    expect(decodeAssetTag(null)).toBeNull();
    expect(decodeAssetTag("")).toBeNull();
  });
});

describe("normaliseAssetTag", () => {
  it("upper-cases and trims", () => {
    expect(normaliseAssetTag("  rdx-zl001 ")).toBe("RDX-ZL001");
  });

  it("turns a blank tag into NULL, never an empty string (spec note 6)", () => {
    // This is what allows many untagged assets to coexist under the unique index.
    expect(normaliseAssetTag("")).toBeNull();
    expect(normaliseAssetTag("   ")).toBeNull();
    expect(normaliseAssetTag(null)).toBeNull();
    expect(normaliseAssetTag(undefined)).toBeNull();
  });
});

describe("tagMismatch", () => {
  it("returns null when the tag agrees with the record", () => {
    expect(tagMismatch({ assetTag: "RDX-ZL001", site: "ZW", category: "laptop" })).toBeNull();
  });

  it("returns null when there is no tag to compare", () => {
    expect(tagMismatch({ assetTag: null, site: "ZW", category: "laptop" })).toBeNull();
  });

  it("reports a country discrepancy in plain English", () => {
    const message = tagMismatch({ assetTag: "RDX-ML001", site: "ZW", category: "laptop" });
    expect(message).toContain("Mozambique");
    expect(message).toContain("Zimbabwe");
  });

  it("reports a type discrepancy", () => {
    const message = tagMismatch({ assetTag: "RDX-ZP001", site: "ZW", category: "laptop" });
    expect(message).toContain("Printer");
    expect(message).toContain("Laptop");
  });

  it("reports both discrepancies at once", () => {
    const message = tagMismatch({ assetTag: "RDX-MP001", site: "ZW", category: "laptop" })!;
    expect(message).toContain("Mozambique");
    expect(message).toContain("Printer");
    expect(message.split(";").length).toBe(2);
  });

  it("flags a tag that does not follow the scheme", () => {
    const message = tagMismatch({ assetTag: "OLD-123", site: "ZW", category: "laptop" });
    expect(message).toContain("does not follow");
  });

  it("tolerates a legacy 'computer' record tagged as a laptop or desktop", () => {
    // Expected during migration from the old system — not worth chasing.
    expect(tagMismatch({ assetTag: "RDX-ZL001", site: "ZW", category: "computer" })).toBeNull();
    expect(tagMismatch({ assetTag: "RDX-ZD001", site: "ZW", category: "computer" })).toBeNull();
    // But a printer tag on a computer record is still a genuine mismatch.
    expect(tagMismatch({ assetTag: "RDX-ZP001", site: "ZW", category: "computer" })).not.toBeNull();
  });
});

describe("expectedTagPrefix", () => {
  it("builds the prefix the scheme would use", () => {
    expect(expectedTagPrefix({ site: "ZW", category: "laptop" })).toBe("RDX-ZL");
    expect(expectedTagPrefix({ site: "GR", category: "starlink" })).toBe("RDX-SS");
    expect(expectedTagPrefix({ site: "NA", category: "phone" })).toBe("RDX-NT");
  });

  it("returns null for a category the scheme has no letter for", () => {
    expect(expectedTagPrefix({ site: "ZW", category: "other" })).toBeNull();
  });
});

describe("repairRecommendation", () => {
  it("recommends replacement at four or more faults", () => {
    expect(repairRecommendation(4).recommendation).toBe("replace");
    expect(repairRecommendation(9).recommendation).toBe("replace");
    expect(repairRecommendation(4).variant).toBe("danger");
  });

  it("recommends watching at two or three faults", () => {
    expect(repairRecommendation(2).recommendation).toBe("watch");
    expect(repairRecommendation(3).recommendation).toBe("watch");
    expect(repairRecommendation(3).variant).toBe("warning");
  });

  it("reports healthy below two faults", () => {
    expect(repairRecommendation(0).recommendation).toBe("ok");
    expect(repairRecommendation(1).recommendation).toBe("ok");
    expect(repairRecommendation(0).detail).toContain("No faults");
    expect(repairRecommendation(1).detail).toContain("1 recorded fault");
  });
});

describe("SITE_CATEGORIES", () => {
  it("assigns shared equipment to sites and personal equipment to people (spec §3.4)", () => {
    expect(isSiteCategory("desktop")).toBe(true);
    expect(isSiteCategory("printer")).toBe(true);
    expect(isSiteCategory("monitor")).toBe(true);
    expect(isSiteCategory("clocking")).toBe(true);
    expect(isSiteCategory("starlink")).toBe(true);
    expect(isSiteCategory("other")).toBe(true);

    expect(isSiteCategory("laptop")).toBe(false);
    expect(isSiteCategory("phone")).toBe(false);
  });
});

describe("initialsOf", () => {
  it("takes first and last initials", () => {
    expect(initialsOf("Tendai Moyo")).toBe("TM");
    expect(initialsOf("Ana Maria Sitoe")).toBe("AS");
  });

  it("handles a single name and empty input", () => {
    expect(initialsOf("Cher")).toBe("CH");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
