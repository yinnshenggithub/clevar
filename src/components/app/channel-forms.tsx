"use client";

import { useActionState } from "react";
import { connectMeta, connectTikTok, type ChannelState } from "@/lib/actions/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type MetaDefaults = {
  pageId: string;
  igUserId: string | null;
  pageName: string | null;
  autoReplyAgentId: string | null;
  features?: { messenger?: boolean; instagram?: boolean; leadgen?: boolean };
};

export function MetaChannelForm({
  agents,
  defaults,
}: {
  agents: { id: string; name: string }[];
  defaults?: MetaDefaults;
}) {
  const [state, formAction, pending] = useActionState<ChannelState, FormData>(connectMeta, {});
  const f = defaults?.features ?? { messenger: true, instagram: true, leadgen: true };

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pageId">Facebook Page ID</Label>
          <Input id="pageId" name="pageId" required defaultValue={defaults?.pageId ?? ""} placeholder="1029384756" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pageName">Page name (label)</Label>
          <Input id="pageName" name="pageName" defaultValue={defaults?.pageName ?? ""} placeholder="Acme Store" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="accessToken">Page access token</Label>
        <Input id="accessToken" name="accessToken" required type="password" placeholder="EAAB…" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="igUserId">Instagram account ID (optional, for IG DMs)</Label>
        <Input id="igUserId" name="igUserId" defaultValue={defaults?.igUserId ?? ""} placeholder="17841400000000000" />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="featMessenger" defaultChecked={f.messenger} className="h-4 w-4" /> Messenger DMs</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="featInstagram" defaultChecked={f.instagram} className="h-4 w-4" /> Instagram DMs</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="featLeadgen" defaultChecked={f.leadgen} className="h-4 w-4" /> Lead Ads</label>
      </div>
      <div className="space-y-2">
        <Label htmlFor="metaAgent">AI auto-reply agent (optional)</Label>
        <Select id="metaAgent" name="autoReplyAgentId" defaultValue={defaults?.autoReplyAgentId ?? ""}>
          <option value="">No auto-reply</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Saved.</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save Meta connection"}</Button>
    </form>
  );
}

export function TikTokChannelForm({ defaults }: { defaults?: { advertiserId: string; advertiserName: string | null } }) {
  const [state, formAction, pending] = useActionState<ChannelState, FormData>(connectTikTok, {});
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="advertiserId">TikTok Advertiser ID</Label>
          <Input id="advertiserId" name="advertiserId" required defaultValue={defaults?.advertiserId ?? ""} placeholder="700000000000000" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="advertiserName">Account name (label)</Label>
          <Input id="advertiserName" name="advertiserName" defaultValue={defaults?.advertiserName ?? ""} placeholder="Acme TikTok" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ttToken">Access token</Label>
        <Input id="ttToken" name="accessToken" required type="password" placeholder="TikTok long-lived token" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Saved.</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save TikTok connection"}</Button>
    </form>
  );
}
