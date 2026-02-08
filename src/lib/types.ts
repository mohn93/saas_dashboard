export type ProductSlug = "somara" | "ulink" | "pushfire";

export interface ProductConfig {
  slug: ProductSlug;
  name: string;
  color: string;
  gaPropertyId: string;
  hasGAMetrics: boolean;
  hasBusinessMetrics: boolean;
  hasSomaraMetrics: boolean;
}

export interface DateRange {
  start: string; // e.g. "30daysAgo" or "2024-01-01"
  end: string; // e.g. "today" or "2024-01-31"
}

export interface KPIs {
  totalUsers: number;
  newUsers: number;
  sessions: number;
  pageviews: number;
  avgSessionDuration: number; // seconds
  bounceRate: number; // 0-1
}

export interface DailyVisitors {
  date: string; // YYYYMMDD
  activeUsers: number;
  newUsers: number;
  sessions: number;
}

export interface TopPage {
  pagePath: string;
  pageTitle: string;
  pageviews: number;
  users: number;
}

export interface ReferrerSource {
  source: string;
  medium: string;
  sessions: number;
  users: number;
}

export interface CountryBreakdown {
  country: string;
  countryId: string;
  users: number;
}

export interface DeviceBreakdown {
  deviceCategory: string;
  users: number;
}

export interface GAMetricsBundle {
  kpis: KPIs;
  visitorsOverTime: DailyVisitors[];
  topPages: TopPage[];
  referrers: ReferrerSource[];
  countries: CountryBreakdown[];
  devices: DeviceBreakdown[];
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  cached: boolean;
  cachedAt: string | null;
}

// Phase 2: ULink Business Metrics

export interface DailySignups {
  date: string;
  signups: number;
}

export interface DailyMRR {
  date: string;
  mrr: number;
}

export interface ULinkBusinessMetrics {
  mrr: number;
  totalSignups: number;
  totalPaidUsers: number;
  visitorToSignupRate: number;
  signupToPaidRate: number;
  signupsOverTime: DailySignups[];
  mrrOverTime: DailyMRR[];
}

// Phase 3: ULink Client Health

export interface OnboardingSteps {
  domainSetup: boolean;
  platformSelection: boolean;
  platformConfig: boolean;
  cliVerified: boolean;
  sdkSetupViewed: boolean;
  platformImplementationViewed: boolean;
}

export interface ProjectHealthSummary {
  projectId: string;
  projectName: string;
  createdAt: string;
  memberCount: number;
  onboardingSteps: OnboardingSteps;
  onboardingProgress: number; // 0-6 (count of completed steps)
  isConfigured: boolean; // has project_configurations row
  linksCreated: number;
  totalClicks: number;
  recentClicks: number; // clicks in the selected date range
  healthScore: "healthy" | "at-risk" | "inactive";
}

export interface ULinkClientHealth {
  totalProjects: number;
  healthyCount: number;
  atRiskCount: number;
  inactiveCount: number;
  avgOnboardingProgress: number; // 0-1
  configuredRate: number; // 0-1
  projectsWithLinks: number;
  projects: ProjectHealthSummary[]; // sorted by healthScore (inactive first)
}

// Somara Platform Metrics

export interface SomaraKPIs {
  totalUsers: number;
  activeUsers: number;
  newSignups: number;
  totalMessages: number;
  totalChats: number;
  tokensUsed: number;
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  messages: number;
  activeUsers: number;
}

export interface DailyTokens {
  date: string;
  tokens: number;
}

export interface OrgBillingBreakdown {
  billingType: string; // usage_based | byok_user | byok_enterprise | internal
  count: number;
}

export interface ModelUsage {
  modelId: string;
  provider: string;
  assistantCount: number;
}

export interface CreditsOverview {
  source: string; // subscription | purchase | bonus | rollover
  totalGranted: number;
  totalConsumed: number;
  totalRemaining: number;
}

export interface SomaraMetrics {
  kpis: SomaraKPIs;
  activityOverTime: DailyActivity[];
  signupsOverTime: DailySignups[];
  tokenUsageOverTime: DailyTokens[];
  orgBillingBreakdown: OrgBillingBreakdown[];
  topModels: ModelUsage[];
  creditsOverview: CreditsOverview[];
}
