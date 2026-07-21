import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare, FileText, FlaskConical } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { updateAgent, deleteAgent } from "@/lib/actions/agents";
import { loadPropertyCatalog } from "@/lib/agent-properties";
import { normalizeIntake } from "@/lib/agent-intake";
import { PageHeader } from "@/components/app/page-header";
import { AgentForm, type AgentDefaults } from "@/components/app/agent-form";
import { AgentTester } from "@/components/app/agent-tester";
import type { AgentRule } from "@/lib/agent-rule-match";
import { KnowledgeManager, type KnowledgeSourceRow } from "@/components/app/knowledge-manager";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
// Knowledge ingest actions enrich chunks (contextualize + embed) in after() —
// large documents need the full window.
export const maxDuration = 300;

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAuth();
  const data = await withTenant(ctx.workspaceId, async (tx) => {
    const agent = await tx.aiAgent.findFirst({ where: { id, deletedAt: null } });
    if (!agent) return null;
    const all = await tx.knowledgeSource.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        error: true,
        chunkCount: true,
        lastSyncedAt: true,
        agents: { select: { agentId: true } },
      },
    });
    return { agent, all };
  });
  if (!data) notFound();
  const { agent, all } = data;
  const attached: KnowledgeSourceRow[] = all
    .filter((s) => s.agents.some((a) => a.agentId === id))
    .map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      status: s.status,
      error: s.error,
      chunkCount: s.chunkCount,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      usedBy: s.agents.length,
    }));
  const available = all
    .filter((s) => !s.agents.some((a) => a.agentId === id) && s.status === "ready")
    .map((s) => ({ id: s.id, title: s.title, type: s.type }));
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { id: true, fullName: true } } },
  });
  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));
  const catalog = (await loadPropertyCatalog(ctx.workspaceId)).map((e) => ({ qualified: e.qualified, label: e.label }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={agent.name}
        description="Configure on the left, test live on the right."
        action={
          <div className="flex items-center gap-2">
            <Link href={`/app/agents/${id}/chat`}>
              <Button variant="outline" className="gap-2">
                <MessageSquare className="h-4 w-4" /> Chat
              </Button>
            </Link>
            <DeleteButton action={deleteAgent.bind(null, id)} label="Delete agent" />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_clamp(360px,30vw,440px)] lg:items-start">
        {/* Left: configuration (scrolls with the page) */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentForm
                action={updateAgent.bind(null, id)}
                members={memberList}
                catalog={catalog}
                defaults={{
                  name: agent.name,
                  instructions: agent.instructions,
                  model: agent.model,
                  mode: agent.mode,
                  tone: agent.tone,
                  responseStyle: agent.responseStyle,
                  objectives: agent.objectives,
                  constraints: agent.constraints,
                  greeting: agent.greeting,
                  temperature: agent.temperature,
                  handoffEnabled: agent.handoffEnabled,
                  handoffUserId: agent.handoffUserId,
                  rules: Array.isArray(agent.rules) ? (agent.rules as AgentDefaults["rules"]) : [],
                  actions: (agent.actions ?? {}) as unknown as AgentDefaults["actions"],
                  grounding: agent.grounding,
                  refusalLine: agent.refusalLine,
                  languagePolicy: agent.languagePolicy,
                  handoffMessage: agent.handoffMessage,
                  dos: Array.isArray(agent.dos) ? (agent.dos as string[]) : [],
                  donts: Array.isArray(agent.donts) ? (agent.donts as string[]) : [],
                  playbook: Array.isArray(agent.playbook) ? (agent.playbook as AgentDefaults["playbook"]) : [],
                  examples: Array.isArray(agent.examples) ? (agent.examples as AgentDefaults["examples"]) : [],
                  profileFields: Array.isArray(agent.profileFields) ? (agent.profileFields as string[]) : [],
                  intakeFields: normalizeIntake(agent.intakeFields),
                  handoffTriggers: (agent.handoffTriggers ?? {}) as AgentDefaults["handoffTriggers"],
                }}
                submitLabel="Save changes"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Knowledge base
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Import your website, upload files, or paste text. The most relevant passages are
                retrieved per message and grounded into the agent&apos;s answers. Sources are shared
                across the workspace — attach one to several agents.
              </p>
              <KnowledgeManager
                agentId={id}
                sources={attached}
                available={available}
                canManage={canManageWorkspace(ctx.role)}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right: live test panel (pinned on desktop) */}
        <aside className="h-[34rem] lg:sticky lg:top-0 lg:h-[calc(100vh-7rem)] lg:self-start">
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <FlaskConical className="h-4 w-4 text-primary" /> Test agent
              </h2>
              <span className="text-xs text-muted-foreground">Saved config · uses credits</span>
            </div>
            <div className="min-h-0 flex-1">
              <AgentTester
                agentId={id}
                defaultModel={agent.model}
                rules={Array.isArray(agent.rules) ? (agent.rules as unknown as AgentRule[]) : []}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Messages don&apos;t affect live conversations. Save changes first to test edits.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
