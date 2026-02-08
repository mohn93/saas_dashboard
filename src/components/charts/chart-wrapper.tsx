"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

interface ChartWrapperProps {
  title: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

export function ChartWrapper({
  title,
  description,
  loading,
  error,
  children,
}: ChartWrapperProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[280px] w-full rounded-lg" />
          </div>
        ) : error ? (
          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
            <AlertCircle className="mr-2 h-4 w-4 text-destructive" />
            <span className="text-sm">{error}</span>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
