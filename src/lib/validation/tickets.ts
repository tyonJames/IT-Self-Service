import { z } from "zod";
import {
  checkboxField,
  emailField,
  honeypotField,
  longText,
  optionalIntId,
  optionalText,
  requiredText,
  ticketCountryField,
} from "./common";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/domain/tickets";

const priorityEnum = z.enum(TICKET_PRIORITIES as [string, ...string[]]);
const statusEnum = z.enum(TICKET_STATUSES as [string, ...string[]]);

/**
 * Public ticket submission (spec §5.1).
 *
 * Priority is deliberately NOT accepted from the public form: letting anyone
 * on the internet stamp "critical" on their own ticket makes the SLA
 * meaningless. Public tickets start at medium and an agent triages.
 */
export const publicTicketSchema = z.object({
  submitterName: requiredText("Your name", 120),
  submitterEmail: emailField(),
  country: ticketCountryField(),
  siteName: optionalText(150),
  category: requiredText("Issue category", 60),
  deviceType: optionalText(40),
  assetNumber: optionalText(60),
  anydeskId: optionalText(60),
  title: requiredText("A short summary", 200),
  description: longText("A description of the problem", 20000),
  sendCopy: checkboxField(),
  website: honeypotField(),
});

export type PublicTicketInput = z.infer<typeof publicTicketSchema>;

/** Internal ticket creation — an agent raising one on someone's behalf. */
export const internalTicketSchema = publicTicketSchema.omit({ website: true }).extend({
  priority: priorityEnum.default("medium"),
  employeeId: optionalIntId(),
  assetId: optionalIntId(),
  assignedToId: optionalIntId(),
});

export const ticketUpdateSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  category: optionalText(60),
  assignedToId: optionalIntId(),
  employeeId: optionalIntId(),
  assetId: optionalIntId(),
  deviceType: optionalText(40),
  anydeskId: optionalText(60),
  siteName: optionalText(150),
  country: ticketCountryField(),
});

export const ticketStatusChangeSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  status: statusEnum,
  note: optionalText(2000),
});

export const ticketAssignSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  assignedToId: optionalIntId(),
});

export const commentSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  body: longText("Comment", 10000),
  isInternal: checkboxField(),
});

/** Ticket list query parameters — parsed so a hand-edited URL cannot inject. */
export const ticketFilterSchema = z.object({
  tab: z.enum(["all", "open", "mine", "overdue", "resolved"]).catch("all"),
  status: statusEnum.optional().catch(undefined),
  priority: priorityEnum.optional().catch(undefined),
  category: z.string().max(60).optional().catch(undefined),
  country: z.string().max(10).optional().catch(undefined),
  assignedTo: z.string().max(20).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  sort: z.enum(["createdAt", "updatedAt", "dueDate", "priority", "status", "title"]).catch("createdAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  from: z.string().max(30).optional().catch(undefined),
  to: z.string().max(30).optional().catch(undefined),
});

export type TicketFilterQuery = z.infer<typeof ticketFilterSchema>;
