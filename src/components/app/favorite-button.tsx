"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toggleFavorite } from "@/lib/actions/favorites";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FavoriteButton({
  entityType,
  entityId,
  label,
  href,
  initial,
}: {
  entityType: string;
  entityId: string;
  label: string;
  href: string;
  initial: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={fav ? "Remove from favorites" : "Add to favorites"}
      disabled={pending}
      onClick={() => {
        setFav((f) => !f);
        start(() => void toggleFavorite(entityType, entityId, label, href));
      }}
    >
      <Star className={cn("h-4 w-4", fav && "fill-amber-400 text-amber-400")} />
    </Button>
  );
}
