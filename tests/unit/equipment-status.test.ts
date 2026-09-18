import { describe, expect, it } from "vitest";
import type { EquipmentStatus } from "@prisma/client";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  CLOSED_EQUIPMENT_STATUSES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_TRANSITIONS,
  InvalidTransitionError,
  isOpenStatus,
  isTerminal,
  OPEN_EQUIPMENT_STATUSES,
} from "@/lib/domain/equipment-status";

/**
 * The equipment request state machine (spec §3.14, instruction §7).
 *
 * The transition matrix is asserted exhaustively — all 49 from×to pairs — so
 * that adding a status or an edge cannot quietly widen what the server accepts.
 */

/** Transcribed directly from the specification, independently of the source. */
const SPEC: Record<EquipmentStatus, EquipmentStatus[]> = {
  submitted: ["review", "approved", "declined", "hold"],
  review: ["approved", "declined", "hold"],
  approved: ["ordered", "issued", "hold", "declined"],
  ordered: ["issued", "hold", "declined"],
  hold: ["review", "approved", "declined"],
  declined: ["review"],
  issued: [],
};

describe("transition matrix", () => {
  it("matches the specification exactly", () => {
    for (const status of EQUIPMENT_STATUSES) {
      expect(new Set(EQUIPMENT_TRANSITIONS[status])).toEqual(new Set(SPEC[status]));
    }
  });

  it("permits and refuses every from×to pair as specified", () => {
    for (const from of EQUIPMENT_STATUSES) {
      for (const to of EQUIPMENT_STATUSES) {
        const expected = SPEC[from].includes(to);
        expect(
          canTransition(from, to),
          `${from} → ${to} should be ${expected ? "allowed" : "refused"}`,
        ).toBe(expected);
      }
    }
  });

  it("never allows a status to transition to itself", () => {
    for (const status of EQUIPMENT_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("treats issued as terminal", () => {
    expect(isTerminal("issued")).toBe(true);
    expect(allowedTransitions("issued")).toEqual([]);
    for (const to of EQUIPMENT_STATUSES) {
      expect(canTransition("issued", to)).toBe(false);
    }
  });

  it("allows a declined request to be reopened only into review", () => {
    expect(allowedTransitions("declined")).toEqual(["review"]);
    expect(canTransition("declined", "approved")).toBe(false);
    expect(canTransition("declined", "issued")).toBe(false);
  });

  it("does not allow skipping straight from submitted to ordered or issued", () => {
    expect(canTransition("submitted", "ordered")).toBe(false);
    expect(canTransition("submitted", "issued")).toBe(false);
  });

  it("allows approved to go straight to issued, bypassing ordered", () => {
    // Kit already on the shelf does not need to be ordered first.
    expect(canTransition("approved", "issued")).toBe(true);
  });
});

describe("assertTransition", () => {
  it("passes silently on a valid move", () => {
    expect(() => assertTransition("submitted", "review")).not.toThrow();
  });

  it("throws InvalidTransitionError on an invalid move", () => {
    expect(() => assertTransition("issued", "review")).toThrow(InvalidTransitionError);
  });

  it("carries a 409 status and a message naming both ends", () => {
    try {
      assertTransition("declined", "issued");
      expect.unreachable("should have thrown");
    } catch (error) {
      const err = error as InvalidTransitionError;
      expect(err.status).toBe(409);
      expect(err.from).toBe("declined");
      expect(err.to).toBe("issued");
      expect(err.message).toContain("Declined");
      expect(err.message).toContain("Issued");
    }
  });
});

describe("open and closed sets", () => {
  it("matches the specification", () => {
    expect(new Set(OPEN_EQUIPMENT_STATUSES)).toEqual(
      new Set(["submitted", "review", "approved", "ordered", "hold"]),
    );
    expect(new Set(CLOSED_EQUIPMENT_STATUSES)).toEqual(new Set(["issued", "declined"]));
  });

  it("partitions every status exactly once", () => {
    for (const status of EQUIPMENT_STATUSES) {
      const open = OPEN_EQUIPMENT_STATUSES.includes(status);
      const closed = CLOSED_EQUIPMENT_STATUSES.includes(status);
      expect(open !== closed, `${status} must be either open or closed, not both or neither`).toBe(
        true,
      );
      expect(isOpenStatus(status)).toBe(open);
    }
  });
});
