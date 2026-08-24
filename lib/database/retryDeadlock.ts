export interface DeadlockRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export async function retryPostgresDeadlock<T>(
  operation: () => Promise<T>,
  options: DeadlockRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isPostgresDeadlock(error) || attempt === maxAttempts) throw error;
      const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(random() * baseDelayMs);
      await sleep(exponentialDelay + jitter);
    }
  }

  throw new Error("Postgres deadlock retry exhausted unexpectedly");
}

export function isPostgresDeadlock(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  if (candidate.code === "40P01" || candidate.code === "P2034") return true;
  if (candidate.code === "P2010" && candidate.meta?.code === "40P01") {
    return true;
  }
  const messages = [candidate.message, candidate.meta?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /\b40P01\b|deadlock detected/i.test(messages);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
