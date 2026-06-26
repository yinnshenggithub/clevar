import type { ObjectType } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { deleteNote } from "@/lib/actions/notes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskComposer } from "@/components/app/task-composer";
import { TaskItem } from "@/components/app/task-item";
import { NoteComposer } from "@/components/app/note-composer";

function fmt(d: Date): string {
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export async function RecordActivity({
  parentType,
  parentId,
}: {
  parentType: ObjectType;
  parentId: string;
}) {
  const ctx = await requireAuth();
  const [tasks, notes, events, members] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) =>
      tx.task.findMany({ where: { parentType, parentId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    ),
    withTenant(ctx.workspaceId, (tx) =>
      tx.note.findMany({ where: { parentType, parentId }, orderBy: { createdAt: "desc" } }),
    ),
    withTenant(ctx.workspaceId, (tx) =>
      tx.activityEvent.findMany({ where: { parentType, parentId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, fullName: true } } },
    }),
  ]);

  const memberList = members.map((m) => ({ id: m.user.id, name: m.user.fullName }));
  const nameById = new Map(memberList.map((m) => [m.id, m.name]));
  const openTasks = tasks.filter((t) => t.status !== "DONE");
  const doneTasks = tasks.filter((t) => t.status === "DONE");
  const feed = events.filter((e) => e.type !== "note");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Tasks</CardTitle>
          <TaskComposer parentType={parentType} parentId={parentId} members={memberList} />
        </CardHeader>
        <CardContent className="space-y-2">
          {openTasks.length === 0 && doneTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          )}
          {openTasks.map((t) => (
            <TaskItem
              key={t.id}
              task={{ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt ? t.dueAt.toISOString() : null }}
              assigneeName={t.assigneeId ? nameById.get(t.assigneeId) : undefined}
            />
          ))}
          {doneTasks.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">{doneTasks.length} completed</summary>
              <div className="mt-2 space-y-2">
                {doneTasks.map((t) => (
                  <TaskItem
                    key={t.id}
                    task={{ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt ? t.dueAt.toISOString() : null }}
                    assigneeName={t.assigneeId ? nameById.get(t.assigneeId) : undefined}
                  />
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes &amp; activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <NoteComposer parentType={parentType} parentId={parentId} />

          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="group rounded-md bg-secondary/50 p-2.5 text-sm">
                <div className="whitespace-pre-wrap">{n.body}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{fmt(n.createdAt)}</span>
                  <form action={deleteNote.bind(null, n.id, parentType, parentId)}>
                    <button type="submit" className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}

            {feed.length > 0 && (
              <ul className="space-y-1.5 border-t border-border pt-3">
                {feed.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {e.summary}
                      {e.actorId && nameById.has(e.actorId) ? ` · ${nameById.get(e.actorId)}` : ""}
                    </span>
                    <span className="shrink-0">{fmt(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}

            {notes.length === 0 && feed.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
