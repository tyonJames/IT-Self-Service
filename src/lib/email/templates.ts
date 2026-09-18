import { env } from "@/lib/config/env";
import { ticketReference } from "@/lib/domain/tickets";
import { countryName } from "@/lib/config/countries";
import { formatDateTime } from "@/lib/utils/format";
import { supportContact } from "@/lib/config/support";

/**
 * Email bodies.
 *
 * Plain text is the primary format — it renders everywhere, survives strict
 * mail clients, and cannot carry an injection. A minimal HTML part is included
 * for readability; all interpolated values pass through `escapeHtml`.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function baseUrl(): string {
  return env().APP_BASE_URL.replace(/\/+$/, "");
}

function signature(): string {
  const s = supportContact();
  return [
    "",
    "— Radx IT Help Desk",
    s.phone ? `Phone: ${s.phone}` : "",
    s.email ? `Email: ${s.email}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function wrapHtml(title: string, bodyLines: string[]): string {
  const rows = bodyLines.map((line) => `<p style="margin:0 0 12px">${line}</p>`).join("");
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#222;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="border-left:4px solid #2d7a45;padding-left:12px;margin-bottom:20px">
<strong style="font-size:17px;color:#1e5a31">${escapeHtml(title)}</strong>
</div>
${rows}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
<p style="font-size:13px;color:#666;margin:0">Radx IT Help Desk</p>
</div></body></html>`;
}

export interface TicketEmailFacts {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  country: string;
  siteName: string;
  submitterName: string;
  submitterEmail: string;
  dueDate: Date | null;
  createdAt: Date;
  assignedToName?: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function ticketSubmittedToReporter(ticket: TicketEmailFacts): RenderedEmail {
  const ref = ticketReference(ticket.id);
  const subject = `[${ref}] We have your request: ${ticket.title}`;
  const text = [
    `Hello ${ticket.submitterName || "there"},`,
    "",
    `Thank you — your IT request has been logged as ${ref}.`,
    "",
    `Summary:  ${ticket.title}`,
    `Category: ${ticket.category}`,
    `Country:  ${countryName(ticket.country)}${ticket.siteName ? ` — ${ticket.siteName}` : ""}`,
    ticket.dueDate ? `Target:   ${formatDateTime(ticket.dueDate)}` : "",
    "",
    "An IT agent will pick this up and contact you. Please quote the reference",
    "number above in any follow-up.",
    signature(),
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const html = wrapHtml(`Request ${ref} received`, [
    `Hello ${escapeHtml(ticket.submitterName || "there")},`,
    `Your IT request has been logged as <strong>${escapeHtml(ref)}</strong>.`,
    `<strong>Summary:</strong> ${escapeHtml(ticket.title)}<br>
     <strong>Category:</strong> ${escapeHtml(ticket.category)}<br>
     <strong>Country:</strong> ${escapeHtml(countryName(ticket.country))}${ticket.siteName ? ` — ${escapeHtml(ticket.siteName)}` : ""}` +
      (ticket.dueDate ? `<br><strong>Target:</strong> ${escapeHtml(formatDateTime(ticket.dueDate))}` : ""),
    "An IT agent will pick this up and contact you. Please quote the reference number in any follow-up.",
  ]);

  return { subject, text, html };
}

export function ticketSubmittedToAgents(ticket: TicketEmailFacts): RenderedEmail {
  const ref = ticketReference(ticket.id);
  const link = `${baseUrl()}/tickets/${ticket.id}/`;
  const subject = `[${ref}] New ${ticket.priority} ticket — ${ticket.title}`;
  const text = [
    `A new ticket has been submitted.`,
    "",
    `Reference: ${ref}`,
    `Title:     ${ticket.title}`,
    `Priority:  ${ticket.priority}`,
    `Category:  ${ticket.category}`,
    `From:      ${ticket.submitterName} <${ticket.submitterEmail}>`,
    `Country:   ${countryName(ticket.country)}${ticket.siteName ? ` — ${ticket.siteName}` : ""}`,
    ticket.dueDate ? `SLA due:   ${formatDateTime(ticket.dueDate)}` : "",
    "",
    "Description:",
    ticket.description,
    "",
    `Open it: ${link}`,
  ].join("\n");

  const html = wrapHtml(`New ticket ${ref}`, [
    `<strong>${escapeHtml(ticket.title)}</strong>`,
    `<strong>Priority:</strong> ${escapeHtml(ticket.priority)} &middot; <strong>Category:</strong> ${escapeHtml(ticket.category)}`,
    `<strong>From:</strong> ${escapeHtml(ticket.submitterName)} &lt;${escapeHtml(ticket.submitterEmail)}&gt;`,
    `<strong>Country:</strong> ${escapeHtml(countryName(ticket.country))}${ticket.siteName ? ` — ${escapeHtml(ticket.siteName)}` : ""}`,
    ticket.dueDate ? `<strong>SLA due:</strong> ${escapeHtml(formatDateTime(ticket.dueDate))}` : "",
    `<a href="${escapeHtml(link)}" style="color:#2d7a45">Open ticket ${escapeHtml(ref)}</a>`,
  ]);

  return { subject, text, html };
}

export function ticketStatusChanged(
  ticket: TicketEmailFacts,
  previousStatus: string,
  note: string,
): RenderedEmail {
  const ref = ticketReference(ticket.id);
  const subject = `[${ref}] Status updated: ${previousStatus} → ${ticket.status}`;
  const text = [
    `Hello ${ticket.submitterName || "there"},`,
    "",
    `Your request ${ref} (“${ticket.title}”) has moved from ${previousStatus} to ${ticket.status}.`,
    note ? `\nNote from IT:\n${note}` : "",
    signature(),
  ].join("\n");

  const html = wrapHtml(`${ref} — status updated`, [
    `Hello ${escapeHtml(ticket.submitterName || "there")},`,
    `Your request <strong>${escapeHtml(ref)}</strong> (“${escapeHtml(ticket.title)}”) has moved from
     <strong>${escapeHtml(previousStatus)}</strong> to <strong>${escapeHtml(ticket.status)}</strong>.`,
    note ? `<em>${escapeHtml(note)}</em>` : "",
  ]);

  return { subject, text, html };
}

export function ticketAssigned(ticket: TicketEmailFacts, agentName: string): RenderedEmail {
  const ref = ticketReference(ticket.id);
  const link = `${baseUrl()}/tickets/${ticket.id}/`;
  const subject = `[${ref}] Assigned to you — ${ticket.title}`;
  const text = [
    `Hello ${agentName},`,
    "",
    `Ticket ${ref} has been assigned to you.`,
    "",
    `Title:    ${ticket.title}`,
    `Priority: ${ticket.priority}`,
    `From:     ${ticket.submitterName} <${ticket.submitterEmail}>`,
    ticket.dueDate ? `SLA due:  ${formatDateTime(ticket.dueDate)}` : "",
    "",
    `Open it: ${link}`,
  ].join("\n");

  const html = wrapHtml(`${ref} assigned to you`, [
    `Hello ${escapeHtml(agentName)},`,
    `<strong>${escapeHtml(ticket.title)}</strong>`,
    `<strong>Priority:</strong> ${escapeHtml(ticket.priority)}`,
    ticket.dueDate ? `<strong>SLA due:</strong> ${escapeHtml(formatDateTime(ticket.dueDate))}` : "",
    `<a href="${escapeHtml(link)}" style="color:#2d7a45">Open ticket</a>`,
  ]);

  return { subject, text, html };
}

export function ticketReplyToAgents(
  ticket: TicketEmailFacts,
  authorName: string,
  body: string,
): RenderedEmail {
  const ref = ticketReference(ticket.id);
  const link = `${baseUrl()}/tickets/${ticket.id}/`;
  return {
    subject: `[${ref}] New reply from ${authorName}`,
    text: [`${authorName} replied on ${ref} (“${ticket.title}”):`, "", body, "", `Open it: ${link}`].join("\n"),
    html: wrapHtml(`New reply on ${ref}`, [
      `<strong>${escapeHtml(authorName)}</strong> replied on “${escapeHtml(ticket.title)}”:`,
      `<em>${escapeHtml(body)}</em>`,
      `<a href="${escapeHtml(link)}" style="color:#2d7a45">Open ticket</a>`,
    ]),
  };
}

export interface EquipmentEmailFacts {
  id: number;
  requesterName: string;
  requesterEmail: string;
  country: string;
  siteName: string;
  priority: string;
  status: string;
  items: string[];
  reason: string;
}

export function equipmentRequestConfirmation(request: EquipmentEmailFacts): RenderedEmail {
  const link = `${baseUrl()}/request-equipment/sent/${request.id}/`;
  const itemList = request.items.length > 0 ? request.items.join(", ") : "(no items listed)";
  return {
    subject: `Equipment request #${request.id} received`,
    text: [
      `Hello ${request.requesterName || "there"},`,
      "",
      `Your equipment request has been logged as #${request.id}.`,
      "",
      `Items:    ${itemList}`,
      `Priority: ${request.priority}`,
      `Country:  ${countryName(request.country)}${request.siteName ? ` — ${request.siteName}` : ""}`,
      request.reason ? `Reason:   ${request.reason}` : "",
      "",
      "IT will review it and let you know the outcome.",
      `Reference page: ${link}`,
      signature(),
    ].join("\n"),
    html: wrapHtml(`Equipment request #${request.id} received`, [
      `Hello ${escapeHtml(request.requesterName || "there")},`,
      `Your equipment request has been logged as <strong>#${request.id}</strong>.`,
      `<strong>Items:</strong> ${escapeHtml(itemList)}<br><strong>Priority:</strong> ${escapeHtml(request.priority)}`,
      "IT will review it and let you know the outcome.",
    ]),
  };
}

export function equipmentRequestToAgents(request: EquipmentEmailFacts): RenderedEmail {
  const link = `${baseUrl()}/equipment/${request.id}/`;
  const itemList = request.items.length > 0 ? request.items.join(", ") : "(no items listed)";
  return {
    subject: `New equipment request #${request.id} (${request.priority}) — ${request.requesterName}`,
    text: [
      "A new equipment request has been submitted.",
      "",
      `Requester: ${request.requesterName} <${request.requesterEmail}>`,
      `Items:     ${itemList}`,
      `Priority:  ${request.priority}`,
      `Country:   ${countryName(request.country)}${request.siteName ? ` — ${request.siteName}` : ""}`,
      request.reason ? `Reason:    ${request.reason}` : "",
      "",
      `Review it: ${link}`,
    ].join("\n"),
    html: wrapHtml(`New equipment request #${request.id}`, [
      `<strong>${escapeHtml(request.requesterName)}</strong> &lt;${escapeHtml(request.requesterEmail)}&gt;`,
      `<strong>Items:</strong> ${escapeHtml(itemList)}`,
      `<strong>Priority:</strong> ${escapeHtml(request.priority)}`,
      `<a href="${escapeHtml(link)}" style="color:#2d7a45">Review request</a>`,
    ]),
  };
}

export function equipmentDecision(request: EquipmentEmailFacts, note: string): RenderedEmail {
  return {
    subject: `Equipment request #${request.id} — ${request.status}`,
    text: [
      `Hello ${request.requesterName || "there"},`,
      "",
      `Your equipment request #${request.id} is now: ${request.status}.`,
      note ? `\nNote from IT:\n${note}` : "",
      signature(),
    ].join("\n"),
    html: wrapHtml(`Equipment request #${request.id}`, [
      `Hello ${escapeHtml(request.requesterName || "there")},`,
      `Your request is now <strong>${escapeHtml(request.status)}</strong>.`,
      note ? `<em>${escapeHtml(note)}</em>` : "",
    ]),
  };
}

export function passwordResetEmail(name: string, resetUrl: string, ttlMinutes: number): RenderedEmail {
  return {
    subject: "Reset your Radx IT Help Desk password",
    text: [
      `Hello ${name},`,
      "",
      "Someone asked to reset the password on your Radx IT Help Desk account.",
      "If that was you, open the link below within " + ttlMinutes + " minutes:",
      "",
      resetUrl,
      "",
      "If it was not you, ignore this email — your password has not changed.",
      "Nobody from IT will ever ask you for your password.",
      signature(),
    ].join("\n"),
    html: wrapHtml("Reset your password", [
      `Hello ${escapeHtml(name)},`,
      `Someone asked to reset the password on your Radx IT Help Desk account. If that was you, use the link below within ${ttlMinutes} minutes.`,
      `<a href="${escapeHtml(resetUrl)}" style="color:#2d7a45">Reset password</a>`,
      "If it was not you, ignore this email — your password has not changed.",
    ]),
  };
}
