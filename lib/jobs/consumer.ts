import type { MessageMetadata, RetryDirective } from "@vercel/queue";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import {
  MAX_JOB_DELIVERIES,
  SCRAPE_QUEUE_MESSAGE_VERSION,
  SCRAPE_QUEUE_TOPIC,
  isScrapeQueueMessageV1,
  type ScrapeQueueMessageV1,
} from "./contracts";
import { classifyJobError, sanitizeJobFailure } from "./errors";
import {
  claimJobDelivery,
  getJobById,
  recordPermanentFailure,
  recordRetryableFailure,
} from "./repository";
import {
  createDefaultWorkerRegistry,
  prepareJobSnapshot,
  type JobWorkerRegistry,
} from "./workers";
import { publishScrapeJob } from "./publisher";
import type { JobRecord } from "./repository";

type ConsumerPrisma = Pick<
  PrismaClient,
  "$transaction" | "scrapeJob" | "movie"
>;

export interface QueueConsumerDependencies {
  prisma?: ConsumerPrisma;
  workers?: JobWorkerRegistry;
}

export async function processScrapeQueueMessage(
  message: unknown,
  metadata: Pick<MessageMetadata, "deliveryCount" | "topicName">,
  dependencies: QueueConsumerDependencies = {}
): Promise<void> {
  const prisma = await resolvePrisma(dependencies.prisma);
  const possibleJobId = extractPossibleJobId(message);

  if (
    metadata.topicName !== SCRAPE_QUEUE_TOPIC ||
    !isExactQueueMessage(message)
  ) {
    if (possibleJobId) {
      await recordPermanentFailure(
        possibleJobId,
        sanitizeJobFailure("invalid_input", "Invalid queue message"),
        prisma
      );
    }
    return;
  }

  const existing = await getJobById(message.jobId, prisma);
  if (!existing || existing.status === "succeeded" || existing.status === "failed") {
    return;
  }

  const job = await claimJobDelivery(message.jobId, prisma);
  if (!job || job.status !== "running") {
    // A queue redelivery can arrive after the previous callback claimed the
    // row but before it restored QUEUED state (for example, if the DB pool was
    // unavailable during error handling). Acknowledging here would strand the
    // RUNNING row forever, so keep the durable message alive until the lease
    // can be reclaimed.
    const latest = await getJobById(message.jobId, prisma);
    if (latest?.status === "running") {
      throw new QueueDeliveryRetryError(30);
    }
    return;
  }

  try {
    // All upstream Letterboxd work completes before the transaction starts.
    const prepared = await prepareJobSnapshot(
      job,
      dependencies.workers ?? createDefaultWorkerRegistry()
    );
    const now = new Date();

    const childJobs = await prisma.$transaction(async (transaction) => {
      const persistedChildren = await prepared.persist(transaction);
      const completed = await transaction.scrapeJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          errorCode: null,
          errorMessage: null,
          finishedAt: now,
          updatedAt: now,
        },
      });
      if (completed.count !== 1) {
        throw new Error("Scrape job lost its running lease");
      }
      return persistedChildren ?? [];
    });
    await publishWithConcurrency(childJobs, 4, prisma);
  } catch (error) {
    const classified = classifyJobError(error);
    if (!classified.retryable) {
      await recordTerminalFailure(job, classified.failure, prisma);
      return;
    }

    if (metadata.deliveryCount >= MAX_JOB_DELIVERIES) {
      await recordTerminalFailure(
        job,
        sanitizeJobFailure(
          "attempts_exhausted",
          `Maximum deliveries exhausted: ${classified.failure.message}`
        ),
        prisma
      );
      return;
    }

    await recordRetryableFailure(job.id, classified.failure, prisma);
    throw new QueueDeliveryRetryError(classified.retryAfterSeconds, {
      cause: error,
    });
  }
}

async function recordTerminalFailure(
  job: JobRecord,
  failure: Parameters<typeof recordPermanentFailure>[1],
  prisma: ConsumerPrisma
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await markPendingMovieFailed(job, transaction);
    await recordPermanentFailure(job.id, failure, transaction);
  });
}

async function publishWithConcurrency(
  jobs: JobRecord[],
  concurrency: number,
  prisma: ConsumerPrisma
): Promise<void> {
  if (jobs.length === 0) return;
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (index < jobs.length) {
        const child = jobs[index++]!;
        try {
          // Publish immediately. The Vercel consumer group's maximum
          // concurrency provides global backpressure during processing.
          await publishScrapeJob(child, { client: prisma });
        } catch {
          // A later request for the pending movie will create a fresh job.
        }
      }
    })
  );
}

async function markPendingMovieFailed(
  job: Pick<JobRecord, "type" | "resourceKey">,
  prisma: Pick<PrismaClient, "movie">
): Promise<void> {
  if (job.type !== "movie") return;
  const identifier = job.resourceKey.slice("movie:".length);
  if (/^tmdb_\d+$/.test(identifier)) {
    await prisma.movie.updateMany({
      where: {
        tmdbId: Number.parseInt(identifier.slice(5), 10),
        resolutionStatus: "PENDING",
      },
      data: { resolutionStatus: "FAILED" },
    });
    return;
  }
  await prisma.movie.updateMany({
    where: {
      resolutionStatus: "PENDING",
      OR: [
        { letterboxdSlug: identifier },
        { aliases: { some: { slug: identifier } } },
      ],
    },
    data: { resolutionStatus: "FAILED" },
  });
}

export function queueRetryDirective(
  error: unknown,
  metadata: Pick<MessageMetadata, "deliveryCount">
): RetryDirective {
  const requested =
    error instanceof QueueDeliveryRetryError ? error.retryAfterSeconds : undefined;
  return {
    afterSeconds:
      requested ?? Math.min(300, 5 * 2 ** (metadata.deliveryCount - 1)),
  };
}

export class QueueDeliveryRetryError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(retryAfterSeconds?: number, options?: ErrorOptions) {
    super("Scrape job delivery should be retried", options);
    this.name = "QueueDeliveryRetryError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isExactQueueMessage(value: unknown): value is ScrapeQueueMessageV1 {
  if (!isScrapeQueueMessageV1(value)) return false;
  if (!UUID_PATTERN.test(value.jobId)) return false;
  const keys = Object.keys(value as object).sort();
  return (
    keys.length === 2 &&
    keys[0] === "jobId" &&
    keys[1] === "version" &&
    value.version === SCRAPE_QUEUE_MESSAGE_VERSION
  );
}

function extractPossibleJobId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("jobId" in value)) return null;
  const jobId = (value as { jobId?: unknown }).jobId;
  return typeof jobId === "string" && UUID_PATTERN.test(jobId) ? jobId : null;
}

async function resolvePrisma(client?: ConsumerPrisma): Promise<ConsumerPrisma> {
  if (client) return client;
  const prismaModule = await import("@/lib/prisma");
  return prismaModule.prisma;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
