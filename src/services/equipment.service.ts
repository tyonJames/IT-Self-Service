import type { EquipmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertTransition } from "@/lib/domain/equipment-status";
import { normaliseCountryCode } from "@/lib/config/countries";
import { notificationService } from "./notification.service";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { softDeleteData } from "@/repositories/soft-delete";
import {
  equipmentDecision,
  equipmentRequestConfirmation,
  equipmentRequestToAgents,
  type EquipmentEmailFacts,
} from "@/lib/email/templates";
import { lookupRepository } from "@/repositories/lookup.repository";
import { ForbiddenError } from "@/lib/permissions";
import type { AppSession } from "@/lib/auth/session";

/**
 * Equipment request workflow (spec §3.14, §5.13).
 *
 * The state machine is enforced here, server-side, on every transition. The
 * UI renders its buttons from the same transition map, so the two cannot drift
 * — but a stale tab, a replayed POST or a hand-crafted request still hits
 * `assertTransition` and is rejected with 409 (instruction §7).
 */

export interface CreateEquipmentRequestInput {
  requesterName: string;
  requesterEmail: string;
  department: string;
  country: string;
  siteName: string;
  siteId: number | null;
  otherEquipment: string;
  reason: string;
  justification: string;
  priority: "normal" | "urgent";
  sendCopy: boolean;
  items: { item: string; quantity: number }[];
  ipAddress?: string | null;
}

async function emailFacts(requestId: number): Promise<EquipmentEmailFacts> {
  const row = await prisma.equipmentRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: {
      id: true,
      requesterName: true,
      requesterEmail: true,
      country: true,
      siteName: true,
      priority: true,
      status: true,
      reason: true,
      otherEquipment: true,
      items: { select: { item: true, quantity: true } },
    },
  });

  const labels = await lookupRepository.equipmentItemTypeLabels();
  const items = row.items.map((i) => {
    const label = labels.get(i.item) ?? i.item;
    return i.quantity > 1 ? `${i.quantity} × ${label}` : label;
  });
  if (row.otherEquipment) items.push(`Other: ${row.otherEquipment}`);

  return {
    id: row.id,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    country: row.country,
    siteName: row.siteName,
    priority: row.priority,
    status: row.status,
    items,
    reason: row.reason,
  };
}

export const equipmentService = {
  async create(input: CreateEquipmentRequestInput): Promise<number> {
    const country = input.country === "OTHER" ? "OTHER" : normaliseCountryCode(input.country);

    // Match the requester to an employee record (spec §5.2).
    const employee = await prisma.employee.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { email: { equals: input.requesterEmail, mode: "insensitive" } },
          { altEmail: { equals: input.requesterEmail, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });

    const site = input.siteId
      ? await prisma.site.findUnique({ where: { id: input.siteId }, select: { id: true, name: true, code: true } })
      : null;

    // Collapse duplicate items into a quantity: the unique (request, item)
    // constraint exists because the same item twice is a double-click, not a
    // request for two (spec §3.15).
    const merged = new Map<string, number>();
    for (const entry of input.items) {
      if (!entry.item) continue;
      merged.set(entry.item, (merged.get(entry.item) ?? 0) + entry.quantity);
    }

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.equipmentRequest.create({
        data: {
          requesterName: input.requesterName,
          requesterEmail: input.requesterEmail,
          department: input.department,
          country,
          siteName: input.siteName || site?.name || "",
          siteCode: site?.code ?? "",
          siteId: site?.id ?? null,
          employeeId: employee?.id ?? null,
          otherEquipment: input.otherEquipment,
          reason: input.reason,
          justification: input.justification,
          priority: input.priority,
          sendCopy: input.sendCopy,
          status: "submitted",
        },
        select: { id: true },
      });

      if (merged.size > 0) {
        await tx.requestedItem.createMany({
          data: [...merged.entries()].map(([item, quantity]) => ({
            requestId: created.id,
            item,
            quantity: Math.min(999, quantity),
          })),
        });
      }

      return created;
    });

    const facts = await emailFacts(request.id);
    const ids: bigint[] = [];

    if (input.sendCopy && input.requesterEmail) {
      ids.push(
        await notificationService.enqueue({
          kind: "equipment",
          recipient: input.requesterEmail,
          email: equipmentRequestConfirmation(facts),
        }),
      );
    }

    const agentEmail = equipmentRequestToAgents(facts);
    for (const recipient of notificationService.agentRecipients()) {
      ids.push(
        await notificationService.enqueue({ kind: "equipment", recipient, email: agentEmail }),
      );
    }

    await auditService.record({
      event: SecurityEvent.EQUIPMENT_STATUS_CHANGED,
      message: `Equipment request #${request.id} submitted`,
      actorRepr: input.requesterEmail,
      target: "EquipmentRequest",
      targetId: request.id,
      ipAddress: input.ipAddress ?? null,
      detail: { priority: input.priority, country, itemCount: merged.size },
    });

    void notificationService.dispatchAll(ids);

    return request.id;
  },

  /**
   * Apply a status transition. Rejects anything the state machine does not
   * allow, records the event, links issued assets, and notifies the requester
   * — all in one transaction.
   */
  async applyStatus(
    session: AppSession,
    requestId: number,
    toStatus: EquipmentStatus,
    note: string,
    issuedAssetIds: number[] = [],
  ): Promise<void> {
    const existing = await prisma.equipmentRequest.findFirst({
      where: { id: requestId, isDeleted: false },
      select: { id: true, status: true, requesterEmail: true, sendCopy: true },
    });
    if (!existing) throw new ForbiddenError("That equipment request no longer exists.");

    // The single authorisation point for the workflow. Throws
    // InvalidTransitionError (HTTP 409) on anything not in the map.
    assertTransition(existing.status, toStatus);

    const validAssetIds =
      issuedAssetIds.length > 0
        ? (
            await prisma.asset.findMany({
              where: { id: { in: issuedAssetIds }, isDeleted: false },
              select: { id: true },
            })
          ).map((a) => a.id)
        : [];

    await prisma.$transaction(async (tx) => {
      await tx.equipmentRequest.update({
        where: { id: requestId },
        data: {
          status: toStatus,
          decidedById: session.user.id,
          decidedAt: new Date(),
          decisionNote: note,
          ...(toStatus === "issued" ? { issuedAt: new Date() } : {}),
          ...(validAssetIds.length > 0
            ? { issuedAssets: { set: validAssetIds.map((id) => ({ id })) } }
            : {}),
        },
      });

      await tx.equipmentStatusEvent.create({
        data: {
          requestId,
          fromStatus: existing.status,
          toStatus,
          actorId: session.user.id,
          actorRepr: session.user.username,
          note,
        },
      });
    });

    await auditService.record({
      event: SecurityEvent.EQUIPMENT_STATUS_CHANGED,
      message: `Equipment request #${requestId} moved ${existing.status} → ${toStatus}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "EquipmentRequest",
      targetId: requestId,
      detail: { from: existing.status, to: toStatus, issuedAssets: validAssetIds.length },
    });

    if (existing.requesterEmail) {
      const facts = await emailFacts(requestId);
      const id = await notificationService.enqueue({
        kind: "equipment",
        recipient: existing.requesterEmail,
        email: equipmentDecision(facts, note),
      });
      void notificationService.dispatch(id);
    }
  },

  async softDelete(session: AppSession, requestId: number): Promise<void> {
    const existing = await prisma.equipmentRequest.findFirst({
      where: { id: requestId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) throw new ForbiddenError("That equipment request no longer exists.");

    await prisma.equipmentRequest.update({
      where: { id: requestId },
      data: softDeleteData(session.user.id),
    });

    await auditService.record({
      event: SecurityEvent.EQUIPMENT_DELETED,
      message: `Equipment request #${requestId} moved to the recycle bin`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "EquipmentRequest",
      targetId: requestId,
      level: "WARNING",
    });
  },

  /** "2 × Laptop" / "Laptop" — the RequestedItem.label property from spec §3.15. */
  itemLabel(item: string, quantity: number, labels: Map<string, string>): string {
    const name = labels.get(item) ?? item;
    return quantity > 1 ? `${quantity} × ${name}` : name;
  },
};
