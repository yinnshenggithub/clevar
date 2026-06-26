import "server-only";
import type { withTenant } from "./tenant";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export const API_RESOURCES = ["contacts", "companies", "deals"] as const;
export type ApiResource = (typeof API_RESOURCES)[number];

export function isApiResource(r: string): r is ApiResource {
  return (API_RESOURCES as readonly string[]).includes(r);
}

export class ApiValidationError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
function serialize(resource: ApiResource, row: any): Record<string, unknown> {
  if (resource === "contacts")
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      jobTitle: row.jobTitle,
      companyId: row.companyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  if (resource === "companies")
    return { id: row.id, name: row.name, domain: row.domain, industry: row.industry, createdAt: row.createdAt, updatedAt: row.updatedAt };
  return {
    id: row.id,
    title: row.title,
    amount: row.amount != null ? Number(row.amount) : null,
    currency: row.currency,
    status: row.status,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    companyId: row.companyId,
    expectedCloseAt: row.expectedCloseAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listResource(tx: Tx, resource: ApiResource, limit: number, offset: number) {
  const args = { where: { deletedAt: null }, orderBy: { createdAt: "desc" as const }, take: limit, skip: offset };
  const rows =
    resource === "contacts"
      ? await tx.contact.findMany(args)
      : resource === "companies"
        ? await tx.company.findMany(args)
        : await tx.deal.findMany(args);
  return rows.map((r) => serialize(resource, r));
}

export async function getResource(tx: Tx, resource: ApiResource, id: string) {
  const row =
    resource === "contacts"
      ? await tx.contact.findFirst({ where: { id, deletedAt: null } })
      : resource === "companies"
        ? await tx.company.findFirst({ where: { id, deletedAt: null } })
        : await tx.deal.findFirst({ where: { id, deletedAt: null } });
  return row ? serialize(resource, row) : null;
}

export async function createResource(tx: Tx, workspaceId: string, resource: ApiResource, body: any) {
  if (resource === "contacts") {
    if (!body.firstName && !body.lastName && !body.email)
      throw new ApiValidationError("Provide at least firstName, lastName, or email");
    const row = await tx.contact.create({
      data: {
        workspaceId,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        jobTitle: body.jobTitle ?? null,
        companyId: body.companyId ?? null,
      },
    });
    return serialize(resource, row);
  }
  if (resource === "companies") {
    if (!body.name) throw new ApiValidationError("name is required");
    const row = await tx.company.create({
      data: { workspaceId, name: String(body.name), domain: body.domain ?? null, industry: body.industry ?? null },
    });
    return serialize(resource, row);
  }
  // deals
  if (!body.title || !body.pipelineId || !body.stageId)
    throw new ApiValidationError("title, pipelineId, and stageId are required");
  const stage = await tx.stage.findFirst({ where: { id: String(body.stageId), pipelineId: String(body.pipelineId) } });
  if (!stage) throw new ApiValidationError("stage not found in pipeline");
  const amount = body.amount != null && !Number.isNaN(Number(body.amount)) ? Number(body.amount).toFixed(2) : null;
  const row = await tx.deal.create({
    data: {
      workspaceId,
      title: String(body.title),
      amount,
      currency: (body.currency ? String(body.currency) : "USD").toUpperCase().slice(0, 3),
      pipelineId: String(body.pipelineId),
      stageId: String(body.stageId),
      status: stage.stageType,
      companyId: body.companyId ?? null,
    },
  });
  return serialize(resource, row);
}
