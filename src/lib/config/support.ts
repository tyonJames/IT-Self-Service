import { env } from "./env";

/**
 * The Next.js equivalent of the `support_contact` context processor (spec §2).
 * Read server-side in the root layout and passed down as props, so no page
 * needs to reach into `process.env` itself.
 */
export interface SupportContact {
  phone: string;
  whatsapp: string;
  whatsappLink: string;
  email: string;
}

export function supportContact(): SupportContact {
  const e = env();
  const digits = e.SUPPORT_WHATSAPP.replace(/[^\d]/g, "");
  return {
    phone: e.SUPPORT_PHONE,
    whatsapp: e.SUPPORT_WHATSAPP,
    whatsappLink: digits ? `https://wa.me/${digits}` : "",
    email: e.SUPPORT_EMAIL,
  };
}
