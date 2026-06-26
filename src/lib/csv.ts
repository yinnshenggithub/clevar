import Papa from "papaparse";

export type CsvObject = "contacts" | "companies" | "deals";

export const CSV_OBJECTS: CsvObject[] = ["contacts", "companies", "deals"];

export const CSV_LABEL: Record<CsvObject, string> = {
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
};

/** Importable/exportable columns per object (header row of the template). */
export const CSV_HEADERS: Record<CsvObject, string[]> = {
  contacts: ["firstName", "lastName", "email", "phone", "phoneRegion", "jobTitle", "companyName"],
  companies: ["name", "domain", "industry"],
  deals: ["title", "amount", "currency", "companyName", "stageName", "expectedCloseAt"],
};

export function isCsvObject(v: string | undefined | null): v is CsvObject {
  return v === "contacts" || v === "companies" || v === "deals";
}

/** Builds a CSV string from header names + row objects. */
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return Papa.unparse({ fields: headers, data: rows.map((r) => headers.map((h) => r[h] ?? "")) });
}

/** Header-only template CSV. */
export function templateCsv(object: CsvObject): string {
  return toCsv(CSV_HEADERS[object], []);
}

export interface ParsedRow {
  [key: string]: string;
}

/** Parses CSV text into trimmed string records keyed by header. */
export function parseCsv(text: string): { rows: ParsedRow[]; error?: string } {
  const out = Papa.parse<ParsedRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  if (out.errors.length) {
    return { rows: (out.data as ParsedRow[]) ?? [], error: out.errors[0]?.message };
  }
  return { rows: out.data as ParsedRow[] };
}
