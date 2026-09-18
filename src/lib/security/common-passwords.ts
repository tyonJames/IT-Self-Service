/**
 * Common-password blocklist (spec §2).
 *
 * A deliberately compact list: the 12-character minimum already excludes the
 * overwhelming majority of the usual leaked-password corpus, so what remains
 * worth blocking is the long-but-guessable tail — keyboard walks, the
 * company's own name with a year, "Password123!" and friends. Shipping a
 * 20,000-entry list inside the bundle would cost more than it buys here.
 *
 * Entries are compared lower-cased.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "password123!",
  "password@123",
  "passw0rd123",
  "p@ssw0rd123",
  "p@ssword123",
  "qwertyuiop",
  "qwertyuiop123",
  "qwerty123456",
  "1qaz2wsx3edc",
  "zaq12wsxcde3",
  "123456789012",
  "1234567890123",
  "112233445566",
  "abcd1234abcd",
  "letmein12345",
  "welcome12345",
  "welcome123456",
  "administrator",
  "administrator1",
  "iloveyou1234",
  "trustno1234567",
  "changeme1234",
  "changeme123!",
  "temppassword1",
  "temporary123",
  "radxconstruction",
  "radx12345678",
  "radxhelpdesk",
  "radxhelpdesk1",
  "griffintrade",
  "griffintrade1",
  "helpdesk1234",
  "zimbabwe12345",
  "harare1234567",
  "construction1",
  "construction123",
  "companyname123",
  "monkey123456",
  "football12345",
  "sunshine12345",
  "princess12345",
  "dragon1234567",
  "superman12345",
  "qazwsxedcrfv",
  "asdfghjkl123",
  "zxcvbnm12345",
]);
