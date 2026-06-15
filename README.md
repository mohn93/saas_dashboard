This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### ULink Agent performance guardrails

The PM Data Agent runs LLM-generated SQL read-only. To protect the database:

- **Connection / role:** `ULINK_READONLY_DATABASE_URL` connects as the `pm_readonly`
  role, which is `SELECT`-only on the `public` schema (no writes; no access to
  `auth`/`vault`/other schemas). ULink runs on a **single primary** (no read
  replica), so the agent's queries share the DB with production traffic — the
  cost-gate, `statement_timeout`, and these grants are the protection, not a
  replica. If agent load grows, add a Supabase read replica (Pro add-on) and point
  this URL at it. `supabase/ulink_agent_perf_guardrails.sql` adds the `query_log`
  cost columns and sets `statement_timeout=8s`/`work_mem` on `pm_readonly` (already
  applied to the ULink project).
- **Cost-gate (shadow first):** Deploy with `ULINK_AGENT_GATE_ENABLED=false`. Every
  query's planner estimate is logged to `pm_agent.query_log` (`est_cost`,
  `est_rows`). After a few days, set `ULINK_AGENT_MAX_PLAN_COST` /
  `ULINK_AGENT_MAX_PLAN_ROWS` from observed percentiles and set
  `ULINK_AGENT_GATE_ENABLED=true`. Over-budget queries then prompt the user to
  "Run anyway".
- **Rate limit:** `ULINK_AGENT_RATE_LIMIT` queries per `ULINK_AGENT_RATE_WINDOW`
  per user.
