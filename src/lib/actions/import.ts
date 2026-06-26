"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { parseCsv, isCsvObject, type CsvObject } from "@/lib/csv";
import { normalizePhone, InvalidPhoneError } from "@/lib/phone";

const MAX_ROWS = 2000;

export interface ImportError {
  row: number;
  message: string;
}
export interface ImportResult {
  object: CsvObject;
  created: number;
  skipped: number;
  errorCount: number;
  errors: ImportError[];
  truncated: boolean;
  total: number;
}
export interface ImportState {
  error?: string;
  result?: ImportResult;
}

export async function importCsv(
  object: string,
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const ctx = await requireAuth();
  if (!isCsvObject(object)) return { error: "Unknown object type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
  if (file.size > 5 * 1024 * 1024) return { error: "File too large (max 5 MB)." };

  const text = await file.text();
  const { rows, error } = parseCsv(text);
  if (error && rows.length === 0) return { error: `Could not parse CSV: ${error}` };

  const truncated = rows.length > MAX_ROWS;
  const data = rows.slice(0, MAX_ROWS);
  const errors: ImportError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    if (object === "companies") {
      const existing = await withTenant(ctx.workspaceId, (tx) =>
        tx.company.findMany({ where: { deletedAt: null }, select: { name: true } }),
      );
      const seen = new Set(existing.map((c) => c.name.toLowerCase()));
      const creates: { workspaceId: string; name: string; domain: string | null; industry: string | null }[] = [];
      data.forEach((r, i) => {
        const name = (r.name || "").trim();
        if (!name) {
          errors.push({ row: i + 2, message: "Missing required 'name'." });
          return;
        }
        if (seen.has(name.toLowerCase())) {
          skipped++;
          return;
        }
        seen.add(name.toLowerCase());
        creates.push({ workspaceId: ctx.workspaceId, name, domain: r.domain || null, industry: r.industry || null });
      });
      if (creates.length) {
        await withTenant(ctx.workspaceId, (tx) => tx.company.createMany({ data: creates }));
        created = creates.length;
      }
    } else if (object === "contacts") {
      const { existingEmails, companyByName } = await withTenant(ctx.workspaceId, async (tx) => {
        const cs = await tx.contact.findMany({
          where: { deletedAt: null, email: { not: null } },
          select: { email: true },
        });
        const companies = await tx.company.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
        return {
          existingEmails: new Set(cs.map((c) => c.email!.toLowerCase())),
          companyByName: new Map(companies.map((c) => [c.name.toLowerCase(), c.id])),
        };
      });
      const creates: Record<string, unknown>[] = [];
      data.forEach((r, i) => {
        const firstName = r.firstName || null;
        const lastName = r.lastName || null;
        const email = (r.email || "").trim().toLowerCase() || null;
        if (!firstName && !lastName && !email) {
          errors.push({ row: i + 2, message: "Provide at least a name or email." });
          return;
        }
        let phone: string | null = null;
        try {
          phone = normalizePhone(r.phone, r.phoneRegion);
        } catch (e) {
          if (e instanceof InvalidPhoneError) {
            errors.push({ row: i + 2, message: `Invalid phone: "${r.phone}".` });
            return;
          }
          throw e;
        }
        if (email && existingEmails.has(email)) {
          skipped++;
          return;
        }
        if (email) existingEmails.add(email);
        const companyId = r.companyName ? companyByName.get(r.companyName.trim().toLowerCase()) ?? null : null;
        creates.push({
          workspaceId: ctx.workspaceId,
          firstName,
          lastName,
          email,
          phone,
          jobTitle: r.jobTitle || null,
          companyId,
        });
      });
      if (creates.length) {
        await withTenant(ctx.workspaceId, (tx) => tx.contact.createMany({ data: creates as never }));
        created = creates.length;
      }
    } else {
      // deals — insert-only into the default pipeline; resolve stage + company by name.
      const setup = await withTenant(ctx.workspaceId, async (tx) => {
        const pipeline =
          (await tx.pipeline.findFirst({ where: { isDefault: true }, orderBy: { position: "asc" } })) ??
          (await tx.pipeline.findFirst({ orderBy: { position: "asc" } }));
        if (!pipeline) return null;
        const stages = await tx.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { position: "asc" } });
        const companies = await tx.company.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
        return { pipeline, stages, companyByName: new Map(companies.map((c) => [c.name.toLowerCase(), c.id])) };
      });
      if (!setup) return { error: "No pipeline found. Create a pipeline first." };
      const stageByName = new Map(setup.stages.map((s) => [s.name.toLowerCase(), s]));
      const creates: Record<string, unknown>[] = [];
      data.forEach((r, i) => {
        const title = (r.title || "").trim();
        if (!title) {
          errors.push({ row: i + 2, message: "Missing required 'title'." });
          return;
        }
        const stage = (r.stageName && stageByName.get(r.stageName.trim().toLowerCase())) || setup.stages[0];
        if (!stage) {
          errors.push({ row: i + 2, message: "Pipeline has no stages." });
          return;
        }
        let amount: string | null = null;
        if (r.amount) {
          const n = Number(r.amount.replace(/,/g, ""));
          amount = Number.isNaN(n) || n < 0 ? null : n.toFixed(2);
        }
        const companyId = r.companyName ? setup.companyByName.get(r.companyName.trim().toLowerCase()) ?? null : null;
        let expectedCloseAt: Date | null = null;
        if (r.expectedCloseAt) {
          const d = new Date(r.expectedCloseAt);
          expectedCloseAt = Number.isNaN(d.getTime()) ? null : d;
        }
        creates.push({
          workspaceId: ctx.workspaceId,
          title,
          amount,
          currency: (r.currency || "USD").toUpperCase().slice(0, 3),
          pipelineId: setup.pipeline.id,
          stageId: stage.id,
          status: stage.stageType,
          companyId,
          expectedCloseAt,
        });
      });
      if (creates.length) {
        await withTenant(ctx.workspaceId, (tx) => tx.deal.createMany({ data: creates as never }));
        created = creates.length;
      }
    }
  } catch (e) {
    console.error("importCsv failed", e);
    return { error: "Import failed while writing records." };
  }

  revalidatePath(`/app/${object}`);
  return {
    result: { object, created, skipped, errorCount: errors.length, errors: errors.slice(0, 50), truncated, total: rows.length },
  };
}
