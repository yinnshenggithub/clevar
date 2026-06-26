import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export class InvalidPhoneError extends Error {
  constructor() {
    super("INVALID_PHONE");
    this.name = "InvalidPhoneError";
  }
}

/**
 * Normalizes a phone number to E.164 (including country code).
 *
 * Accepts either a complete E.164 string (e.g. "+60123456789") or a national
 * number plus a region (ISO 3166-1 alpha-2, e.g. "MY"). Returns null for empty
 * input; throws InvalidPhoneError for un-parseable input.
 */
export function normalizePhone(
  input: string | null | undefined,
  region?: string | null,
): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(
    trimmed,
    region ? (region.toUpperCase() as CountryCode) : undefined,
  );

  if (!parsed || !parsed.isValid()) {
    throw new InvalidPhoneError();
  }
  return parsed.number; // E.164
}

/** Formats a stored E.164 number for display, falling back to the raw value. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
