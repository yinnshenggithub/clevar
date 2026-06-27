import "server-only";
import { withTenant } from "./tenant";

/**
 * Retrieves the most relevant knowledge-base snippets for an agent using
 * PostgreSQL full-text search (no embeddings key required). Returns a string
 * to inject into the agent's system prompt, or "" if nothing matches.
 */
export async function retrieveContext(
  workspaceId: string,
  agentId: string,
  query: string,
  limit = 3,
): Promise<string> {
  const q = (query || "").trim();
  try {
    let rows: { title: string; content: string }[] = [];

    // 1. Full-text ranked match on the message keywords (best relevance).
    if (q) {
      rows = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`
          SELECT title, content
          FROM agent_documents
          WHERE agent_id = ${agentId}::uuid
            AND to_tsvector('english', title || ' ' || content)
                @@ websearch_to_tsquery('english', ${q})
          ORDER BY ts_rank(
            to_tsvector('english', title || ' ' || content),
            websearch_to_tsquery('english', ${q})
          ) DESC
          LIMIT ${limit}
        `,
      )) as { title: string; content: string }[];
    }

    // 2. Fallback: no keyword match (or empty/vague message) — include the most
    //    recent documents so a small knowledge base is always available to the agent.
    if (!rows.length) {
      rows = (await withTenant(workspaceId, (tx) =>
        tx.$queryRaw`
          SELECT title, content
          FROM agent_documents
          WHERE agent_id = ${agentId}::uuid
          ORDER BY created_at DESC
          LIMIT ${limit}
        `,
      )) as { title: string; content: string }[];
    }

    if (!rows.length) return "";
    return rows.map((r) => `# ${r.title}\n${r.content.slice(0, 2000)}`).join("\n\n");
  } catch (e) {
    console.error("retrieveContext failed", e);
    return "";
  }
}

/** Builds the final system prompt, appending knowledge-base context when present. */
export function buildSystemPrompt(base: string, context: string): string {
  if (!context) return base;
  return `${base}\n\nUse the following knowledge base to answer when relevant. If the answer isn't here, say so honestly.\n\n${context}`;
}
