"use client";

import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface CacheIndicatorProps {
  cached: boolean;
  cachedAt: string | null;
}

export function CacheIndicator({ cached, cachedAt }: CacheIndicatorProps) {
  if (!cached || !cachedAt) return null;

  const timeAgo = formatDistanceToNow(new Date(cachedAt), { addSuffix: true });

  return (
    <Badge variant="secondary" className="text-xs font-normal">
      Data from {timeAgo}
    </Badge>
  );
}
