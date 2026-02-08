"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { ProjectHealthSummary, OnboardingSteps } from "@/lib/types";

interface ProjectHealthTableProps {
  projects: ProjectHealthSummary[];
  loading?: boolean;
}

type SortKey =
  | "name"
  | "members"
  | "onboarding"
  | "links"
  | "clicks"
  | "status";
type SortDir = "asc" | "desc";
type HealthFilter = "all" | "healthy" | "at-risk" | "inactive";

const healthColors: Record<string, string> = {
  healthy: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  "at-risk": "bg-amber-500/10 text-amber-500 border-amber-500/20",
  inactive: "bg-red-500/10 text-red-500 border-red-500/20",
};

const healthOrder: Record<string, number> = {
  healthy: 0,
  "at-risk": 1,
  inactive: 2,
};

const onboardingLabels: { key: keyof OnboardingSteps; label: string }[] = [
  { key: "domainSetup", label: "Domain Setup" },
  { key: "platformSelection", label: "Platform Selection" },
  { key: "platformConfig", label: "Platform Config" },
  { key: "cliVerified", label: "CLI Verified" },
  { key: "sdkSetupViewed", label: "SDK Setup Viewed" },
  { key: "platformImplementationViewed", label: "Platform Implementation" },
];

function OnboardingProgressBar({ progress }: { progress: number }) {
  const percentage = (progress / 6) * 100;

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{progress}/6</span>
    </div>
  );
}

function OnboardingDetails({ steps }: { steps: OnboardingSteps }) {
  return (
    <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-3">
      {onboardingLabels.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              steps[key] ? "bg-emerald-500" : "bg-muted-foreground/30"
            }`}
          />
          <span
            className={
              steps[key] ? "text-foreground" : "text-muted-foreground"
            }
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function SortIcon({
  column,
  activeCol,
  dir,
}: {
  column: SortKey;
  activeCol: SortKey;
  dir: SortDir;
}) {
  if (column !== activeCol) {
    return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/40" />;
  }
  return dir === "asc" ? (
    <ArrowUp className="ml-1 inline h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 inline h-3 w-3" />
  );
}

function sortProjects(
  projects: ProjectHealthSummary[],
  key: SortKey,
  dir: SortDir
): ProjectHealthSummary[] {
  const sorted = [...projects];
  const mult = dir === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (key) {
      case "name":
        return mult * a.projectName.localeCompare(b.projectName);
      case "members":
        return mult * (a.memberCount - b.memberCount);
      case "onboarding":
        return mult * (a.onboardingProgress - b.onboardingProgress);
      case "links":
        return mult * (a.linksCreated - b.linksCreated);
      case "clicks":
        return mult * (a.recentClicks - b.recentClicks);
      case "status":
        return mult * (healthOrder[a.healthScore] - healthOrder[b.healthScore]);
      default:
        return 0;
    }
  });

  return sorted;
}

export function ProjectHealthTable({
  projects,
  loading,
}: ProjectHealthTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<HealthFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = projects;

    if (filter !== "all") {
      result = result.filter((p) => p.healthScore === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.projectName.toLowerCase().includes(q));
    }

    return sortProjects(result, sortKey, sortDir);
  }, [projects, filter, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Projects ({filtered.length}
            {filtered.length !== projects.length
              ? ` of ${projects.length}`
              : ""}
            )
          </CardTitle>

          <div className="flex items-center gap-2">
            {/* Search */}
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-40"
            />

            {/* Status filter pills */}
            <div className="flex gap-1">
              {(["all", "healthy", "at-risk", "inactive"] as const).map(
                (val) => (
                  <button
                    key={val}
                    onClick={() => setFilter(val)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      filter === val
                        ? val === "all"
                          ? "bg-foreground text-background"
                          : val === "healthy"
                          ? "bg-emerald-500/20 text-emerald-500"
                          : val === "at-risk"
                          ? "bg-amber-500/20 text-amber-500"
                          : "bg-red-500/20 text-red-500"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {val === "all"
                      ? "All"
                      : val === "at-risk"
                      ? "At Risk"
                      : val.charAt(0).toUpperCase() + val.slice(1)}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <div className="max-h-[500px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("name")}
                >
                  Project
                  <SortIcon column="name" activeCol={sortKey} dir={sortDir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-center"
                  onClick={() => handleSort("members")}
                >
                  Members
                  <SortIcon
                    column="members"
                    activeCol={sortKey}
                    dir={sortDir}
                  />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("onboarding")}
                >
                  Onboarding
                  <SortIcon
                    column="onboarding"
                    activeCol={sortKey}
                    dir={sortDir}
                  />
                </TableHead>
                <TableHead className="text-center">Configured</TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort("links")}
                >
                  Links
                  <SortIcon column="links" activeCol={sortKey} dir={sortDir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort("clicks")}
                >
                  Clicks
                  <SortIcon
                    column="clicks"
                    activeCol={sortKey}
                    dir={sortDir}
                  />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-center"
                  onClick={() => handleSort("status")}
                >
                  Status
                  <SortIcon
                    column="status"
                    activeCol={sortKey}
                    dir={sortDir}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => {
                const isExpanded = expandedId === project.projectId;

                return (
                  <TableRow
                    key={project.projectId}
                    className="group cursor-pointer"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : project.projectId)
                    }
                  >
                    <TableCell className="w-8 pl-4">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">
                          {project.projectName}
                        </p>
                        {isExpanded && (
                          <OnboardingDetails steps={project.onboardingSteps} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {project.memberCount}
                    </TableCell>
                    <TableCell>
                      <OnboardingProgressBar
                        progress={project.onboardingProgress}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {project.isConfigured ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {project.linksCreated.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {project.recentClicks.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={`text-[10px] ${healthColors[project.healthScore]}`}
                        variant="outline"
                      >
                        {project.healthScore}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {projects.length === 0
                      ? "No projects found"
                      : "No projects match the current filters"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
