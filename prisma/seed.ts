import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { withTenant } from "../src/lib/tenant";

/**
 * Idempotent demo seed: a workspace with an owner, default pipeline, and a few
 * sample records. Safe to re-run; it no-ops if the demo user already exists.
 * Never intended for production data.
 */
async function main() {
  const email = "demo@clevar.app";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Seed: demo user already exists, skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash("demo12345", 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, fullName: "Demo Owner" },
  });
  const workspace = await prisma.workspace.create({ data: { name: "Demo Co", slug: "demo-co" } });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });

  await withTenant(workspace.id, async (tx) => {
    const pipeline = await tx.pipeline.create({
      data: { workspaceId: workspace.id, name: "Sales", isDefault: true, position: 0 },
    });
    const stages = await Promise.all(
      [
        { name: "Lead", position: 0, stageType: "OPEN" as const },
        { name: "Qualified", position: 1, stageType: "OPEN" as const },
        { name: "Proposal", position: 2, stageType: "OPEN" as const },
        { name: "Won", position: 3, stageType: "WON" as const },
        { name: "Lost", position: 4, stageType: "LOST" as const },
      ].map((s) =>
        tx.stage.create({ data: { ...s, workspaceId: workspace.id, pipelineId: pipeline.id } }),
      ),
    );

    const acme = await tx.company.create({
      data: { workspaceId: workspace.id, name: "Acme Inc.", domain: "acme.com", industry: "Software" },
    });
    await tx.contact.create({
      data: {
        workspaceId: workspace.id,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@acme.com",
        phone: "+14155550101",
        jobTitle: "CTO",
        companyId: acme.id,
      },
    });
    await tx.deal.create({
      data: {
        workspaceId: workspace.id,
        title: "Acme — annual plan",
        amount: "12000.00",
        currency: "USD",
        pipelineId: pipeline.id,
        stageId: stages[1]!.id,
        status: "OPEN",
        companyId: acme.id,
      },
    });
  });

  console.log("Seed: created demo workspace (demo@clevar.app / demo12345).");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
