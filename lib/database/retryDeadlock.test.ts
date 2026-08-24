import { describe, expect, it, vi } from "vitest";
import { isPostgresDeadlock, retryPostgresDeadlock } from "./retryDeadlock";

describe("retryPostgresDeadlock", () => {
  it("retries Prisma raw-query deadlock victims with backoff", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), {
      code: "P2010",
      meta: { code: "40P01", message: "deadlock detected" },
    });
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValue("updated");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryPostgresDeadlock(operation, {
        baseDelayMs: 100,
        sleep,
        random: () => 0,
      })
    ).resolves.toBe("updated");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("does not retry unrelated database failures", async () => {
    const failure = Object.assign(new Error("constraint failed"), {
      code: "P2004",
    });
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(failure);

    await expect(retryPostgresDeadlock(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledOnce();
  });
});

describe("isPostgresDeadlock", () => {
  it("recognizes Prisma transaction and PostgreSQL deadlock codes", () => {
    expect(isPostgresDeadlock({ code: "P2034" })).toBe(true);
    expect(isPostgresDeadlock({ code: "40P01" })).toBe(true);
    expect(isPostgresDeadlock({ message: "deadlock detected" })).toBe(true);
    expect(isPostgresDeadlock({ code: "P2028" })).toBe(false);
  });
});
