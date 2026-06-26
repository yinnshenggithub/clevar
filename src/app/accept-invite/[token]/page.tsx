import Link from "next/link";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashInviteToken } from "@/lib/invite-token";
import { acceptInvite } from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { workspace: { select: { name: true } } },
  });
  const valid = Boolean(invitation && !invitation.acceptedAt && invitation.expiresAt > new Date());
  const ctx = await getAuthContext();

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Workspace invitation</CardTitle>
          <CardDescription>
            {valid && invitation
              ? `You've been invited to join ${invitation.workspace.name} as ${invitation.role.toLowerCase()}.`
              : "This invitation is invalid or has expired."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!valid ? (
            <Link href="/">
              <Button variant="outline" className="w-full">
                Back to home
              </Button>
            </Link>
          ) : !ctx ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in or create an account, then open this invite link again to join.
              </p>
              <div className="flex gap-3">
                <Link href="/login" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Sign in
                  </Button>
                </Link>
                <Link href="/signup" className="flex-1">
                  <Button className="w-full">Create account</Button>
                </Link>
              </div>
            </div>
          ) : (
            <form action={acceptInvite.bind(null, token)}>
              <Button type="submit" className="w-full">
                Join {invitation!.workspace.name}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
