import { randomUUID } from "node:crypto";
import { CACHE_TTL_MS } from "@/lib/cache/policy";
import type { PrismaClient, ScrapeJob } from "@/lib/generated/prisma/client";
import {
  ACTIVE_JOB_STATUSES,
  JOB_ENVIRONMENTS,
  type JobEnvironment,
  type JobFailure,
  type JobFailureCode,
  type JobIdentity,
  type JobStatus,
  type JobType,
  parseCanonicalResourceKey,
} from "./contracts";

const RECLAIM_UNCLAIMED_DEVELOPMENT_AFTER_MS = 15_000;
const RECLAIM_UNCLAIMED_DEPLOYED_AFTER_MS = 5 * 60_000;
const RECLAIM_RUNNING_AFTER_MS = 5 * 60_000;
const EXPIRED_UNCLAIMED_JOB_MESSAGE =
  "Queued job was not claimed before its delivery lease expired";
const EXPIRED_RUNNING_JOB_MESSAGE = "Running job lease expired before completion";

export type JobClient = Pick<PrismaClient, "scrapeJob">;

export interface JobRecord {
  id: string;
  environment: JobEnvironment;
  type: JobType;
  resourceKey: JobIdentity["resourceKey"];
  status: JobStatus;
  attempts: number;
  queueMessageId: string | null;
  error: JobFailure | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrReuseJobResult {
  job: JobRecord;
  created: boolean;
  shouldPublish: boolean;
}

export async function createOrReuseJob(
  identity: JobIdentity,
  options: {
    client?: JobClient;
    now?: Date;
  } = {}
): Promise<CreateOrReuseJobResult> {
  assertIdentity(identity);
  const client = await resolveClient(options.client);
  const now = options.now ?? new Date();
  const negativeCache = await client.scrapeJob.findFirst({
    where: {
      environment: toDatabaseEnum(identity.environment),
      type: toDatabaseEnum(identity.type),
      resourceKey: identity.resourceKey,
      status: "FAILED",
      errorCode: "NOT_FOUND",
      finishedAt: {
        gte: new Date(now.getTime() - CACHE_TTL_MS.notFound),
      },
    },
    orderBy: { finishedAt: "desc" },
  });
  if (negativeCache) {
    return {
      job: fromDatabaseJob(negativeCache),
      created: false,
      shouldPublish: false,
    };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const job = await client.scrapeJob.create({
        data: {
          id: randomUUID(),
          environment: toDatabaseEnum(identity.environment),
          type: toDatabaseEnum(identity.type),
          resourceKey: identity.resourceKey,
          updatedAt: now,
        },
      });
      return { job: fromDatabaseJob(job), created: true, shouldPublish: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const existing = await client.scrapeJob.findFirst({
        where: {
          environment: toDatabaseEnum(identity.environment),
          type: toDatabaseEnum(identity.type),
          resourceKey: identity.resourceKey,
          status: { in: ACTIVE_JOB_STATUSES.map(toDatabaseEnum) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        const job = fromDatabaseJob(existing);
        const reclaimUnclaimedAfterMs =
          job.environment === "development"
            ? RECLAIM_UNCLAIMED_DEVELOPMENT_AFTER_MS
            : RECLAIM_UNCLAIMED_DEPLOYED_AFTER_MS;
        if (
          job.status === "queued" &&
          job.attempts === 0 &&
          now.getTime() - job.updatedAt.getTime() >= reclaimUnclaimedAfterMs
        ) {
          // A queue callback can fail before our handler is invoked (for
          // example, when the queue can no longer find the published message).
          // Reusing the same row would also reuse its idempotency key, so retire
          // it and create a fresh job/message instead.
          const expired = await client.scrapeJob.updateMany({
            where: {
              id: job.id,
              status: "QUEUED",
              attempts: 0,
              updatedAt: {
                lte: new Date(now.getTime() - reclaimUnclaimedAfterMs),
              },
            },
            data: {
              status: "FAILED",
              errorCode: "TIMEOUT",
              errorMessage: EXPIRED_UNCLAIMED_JOB_MESSAGE,
              finishedAt: now,
              updatedAt: now,
            },
          });
          if (expired.count === 1) continue;
        }
        if (
          job.status === "running" &&
          job.startedAt &&
          now.getTime() - job.startedAt.getTime() >= RECLAIM_RUNNING_AFTER_MS
        ) {
          const expired = await client.scrapeJob.updateMany({
            where: {
              id: job.id,
              status: "RUNNING",
              startedAt: {
                lte: new Date(now.getTime() - RECLAIM_RUNNING_AFTER_MS),
              },
            },
            data: {
              status: "FAILED",
              errorCode: "TIMEOUT",
              errorMessage: EXPIRED_RUNNING_JOB_MESSAGE,
              finishedAt: now,
              updatedAt: now,
            },
          });
          if (expired.count === 1) continue;
        }
        return {
          job,
          created: false,
          shouldPublish: false,
        };
      }
      // The conflicting active row may have completed between the INSERT and
      // lookup. Retry once so this request can create the next refresh.
    }
  }

  throw new Error("Unable to create or reuse scrape job");
}

export async function getJobById(
  jobId: string,
  client?: JobClient
): Promise<JobRecord | null> {
  const resolved = await resolveClient(client);
  const job = await resolved.scrapeJob.findUnique({ where: { id: jobId } });
  return job ? fromDatabaseJob(job) : null;
}

export async function recordPublicationSucceeded(
  jobId: string,
  messageId: string | null,
  client?: JobClient
): Promise<JobRecord | null> {
  const resolved = await resolveClient(client);
  const result = await resolved.scrapeJob.updateMany({
    where: { id: jobId },
    data: {
      ...(messageId ? { queueMessageId: messageId } : {}),
      updatedAt: new Date(),
    },
  });
  if (result.count === 0) return getJobById(jobId, resolved);
  return getJobById(jobId, resolved);
}

export async function recordPublicationFailed(
  jobId: string,
  failure: JobFailure,
  client?: JobClient
): Promise<JobRecord | null> {
  const resolved = await resolveClient(client);
  const now = new Date();
  await resolved.scrapeJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: {
      status: "FAILED",
      errorCode: toDatabaseEnum(failure.code),
      errorMessage: failure.message,
      finishedAt: now,
      updatedAt: now,
    },
  });
  return getJobById(jobId, resolved);
}

export async function claimJobDelivery(
  jobId: string,
  client?: JobClient
): Promise<JobRecord | null> {
  const resolved = await resolveClient(client);
  const now = new Date();
  const result = await resolved.scrapeJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "QUEUED" },
        {
          status: "RUNNING",
          startedAt: {
            lte: new Date(now.getTime() - RECLAIM_RUNNING_AFTER_MS),
          },
        },
      ],
    },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    },
  });
  if (result.count === 0) return null;
  return getJobById(jobId, resolved);
}

export async function recordRetryableFailure(
  jobId: string,
  failure: JobFailure,
  client?: JobClient
): Promise<void> {
  const resolved = await resolveClient(client);
  await resolved.scrapeJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: "QUEUED",
      errorCode: toDatabaseEnum(failure.code),
      errorMessage: failure.message,
      updatedAt: new Date(),
    },
  });
}

export async function recordPermanentFailure(
  jobId: string,
  failure: JobFailure,
  client?: JobClient
): Promise<void> {
  const resolved = await resolveClient(client);
  const now = new Date();
  await resolved.scrapeJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "FAILED",
      errorCode: toDatabaseEnum(failure.code),
      errorMessage: failure.message,
      finishedAt: now,
      updatedAt: now,
    },
  });
}

function assertIdentity(identity: JobIdentity): void {
  if (!(JOB_ENVIRONMENTS as readonly string[]).includes(identity.environment)) {
    throw new TypeError("Invalid job environment");
  }
  const parsed = parseCanonicalResourceKey(identity.resourceKey);
  if (!parsed || parsed.type !== identity.type) {
    throw new TypeError("Job type and canonical resource key do not match");
  }
}

export function fromDatabaseJob(job: ScrapeJob): JobRecord {
  return {
    id: job.id,
    environment: fromDatabaseEnum<JobEnvironment>(job.environment),
    type: fromDatabaseEnum<JobType>(job.type),
    resourceKey: job.resourceKey as JobIdentity["resourceKey"],
    status: fromDatabaseEnum<JobStatus>(job.status),
    attempts: job.attempts,
    queueMessageId: job.queueMessageId,
    error:
      job.errorCode && job.errorMessage
        ? {
            code: fromDatabaseEnum<JobFailureCode>(job.errorCode),
            message: job.errorMessage,
          }
        : null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toDatabaseEnum<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

function fromDatabaseEnum<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function resolveClient(client?: JobClient): Promise<JobClient> {
  if (client) return client;
  const prismaModule = await import("@/lib/prisma");
  return prismaModule.prisma;
}
