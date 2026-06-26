import { requireAuth } from "@/lib/auth";
import { createAgent } from "@/lib/actions/agents";
import { PageHeader } from "@/components/app/page-header";
import { AgentForm } from "@/components/app/agent-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  await requireAuth();
  return (
    <div>
      <PageHeader title="New agent" description="Give your assistant a role and instructions." />
      <Card>
        <CardContent className="pt-6">
          <AgentForm action={createAgent} submitLabel="Create agent" />
        </CardContent>
      </Card>
    </div>
  );
}
