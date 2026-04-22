import { beforeEach, describe, expect, it, vi } from "vitest";

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

const usersViewResult = vi.hoisted(
  () => ({ current: { data: [], error: null } }) as {
    current: SupabaseResult<Array<{ id: string }>>;
  }
);
const subscriptionsResult = vi.hoisted(
  () => ({ current: { data: [], error: null } }) as {
    current: SupabaseResult<Array<{ projects: { created_by: string } | null }>>;
  }
);

vi.mock("./client", () => {
  const thenable = (table: string) => {
    // Each terminal filter call returns a thenable resolving to the preset result.
    const resolve = () =>
      table === "users_view" ? usersViewResult.current : subscriptionsResult.current;
    const builder: Record<string, unknown> = {
      select: () => builder,
      gte: () => builder,
      lte: () => builder,
      in: () => builder,
      eq: () => builder,
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled),
    };
    return builder;
  };

  return {
    getULinkClient: () => ({
      from: (table: string) => thenable(table),
    }),
  };
});

import { fetchPaidCohortCount } from "./queries";

const start = new Date("2026-04-01T00:00:00Z");
const end = new Date("2026-04-30T23:59:59Z");

beforeEach(() => {
  usersViewResult.current = { data: [], error: null };
  subscriptionsResult.current = { data: [], error: null };
});

describe("fetchPaidCohortCount", () => {
  it("returns 0 when no users signed up in the window (skips the second query)", async () => {
    usersViewResult.current = { data: [], error: null };
    subscriptionsResult.current = {
      data: [{ projects: { created_by: "u-paid" } }],
      error: null,
    };

    expect(await fetchPaidCohortCount(start, end)).toBe(0);
  });

  it("counts only paid owners whose signup falls inside the cohort", async () => {
    usersViewResult.current = {
      data: [{ id: "u-1" }, { id: "u-2" }, { id: "u-3" }],
      error: null,
    };
    subscriptionsResult.current = {
      data: [
        { projects: { created_by: "u-1" } }, // in cohort  ✅
        { projects: { created_by: "u-2" } }, // in cohort  ✅
        { projects: { created_by: "u-outside" } }, // NOT in cohort  ❌
      ],
      error: null,
    };

    expect(await fetchPaidCohortCount(start, end)).toBe(2);
  });

  it("counts each paying user once even when they own multiple paid projects", async () => {
    usersViewResult.current = { data: [{ id: "u-1" }], error: null };
    subscriptionsResult.current = {
      data: [
        { projects: { created_by: "u-1" } },
        { projects: { created_by: "u-1" } },
        { projects: { created_by: "u-1" } },
      ],
      error: null,
    };

    expect(await fetchPaidCohortCount(start, end)).toBe(1);
  });

  it("ignores subscription rows with null or missing project joins", async () => {
    usersViewResult.current = {
      data: [{ id: "u-1" }, { id: "u-2" }],
      error: null,
    };
    subscriptionsResult.current = {
      data: [
        { projects: { created_by: "u-1" } },
        { projects: null },
        { projects: { created_by: "u-2" } },
      ],
      error: null,
    };

    expect(await fetchPaidCohortCount(start, end)).toBe(2);
  });

  it("returns 0 when the cohort query errors", async () => {
    usersViewResult.current = { data: null, error: { message: "boom" } };
    subscriptionsResult.current = {
      data: [{ projects: { created_by: "u-1" } }],
      error: null,
    };

    expect(await fetchPaidCohortCount(start, end)).toBe(0);
  });

  it("returns 0 when the subscriptions query errors", async () => {
    usersViewResult.current = { data: [{ id: "u-1" }], error: null };
    subscriptionsResult.current = { data: null, error: { message: "boom" } };

    expect(await fetchPaidCohortCount(start, end)).toBe(0);
  });
});
