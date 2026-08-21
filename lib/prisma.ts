import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const requestedPoolSize = Number.parseInt(
  process.env.DATABASE_POOL_MAX ?? "2",
  10
);
const poolMax = Number.isFinite(requestedPoolSize)
  ? Math.min(4, Math.max(1, requestedPoolSize))
  : 2;

const adapter = new PrismaPg(
  {
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  },
  {
    // Intentionally omit statementNameGenerator. PrismaPg then sends unnamed
    // statements, which are safe with Supavisor transaction mode.
  }
);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    // Fluid Compute can run several queue callbacks in one process. Prisma's
    // two-second interactive-transaction default is too short when those
    // callbacks briefly share this small serverless pool.
    transactionOptions: {
      maxWait: 30_000,
      timeout: 60_000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
