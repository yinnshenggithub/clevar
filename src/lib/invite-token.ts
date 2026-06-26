import { createHash } from "crypto";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
