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

type ConsumerPrisma = Pick<PrismaClient, "$transaction" | "scrapeJob">;

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
  if (!job || job.status !== "running") return;

  try {
    // All Letterboxd/TMDB work completes here, before the transaction starts.
    const prepared = await prepareJobSnapshot(
      job,
      dependencies.workers ?? createDefaultWorkerRegistry()
    );
    const now = new Date();

    await prisma.$transaction(async (transaction) => {
      await prepared.persist(transaction);
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
    });
  } catch (error) {
    const classified = classifyJobError(error);
    if (!classified.retryable) {
      await recordPermanentFailure(job.id, classified.failure, prisma);
      return;
    }

    if (metadata.deliveryCount >= MAX_JOB_DELIVERIES) {
      await recordPermanentFailure(
        job.id,
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

export function queueRetryDirective(
  error: unknown,
  metadata: Pick<MessageMetadata, "deliveryCount">
): RetryDirective {
  if (metadata.deliveryCount >= MAX_JOB_DELIVERIES) {
    return { acknowledge: true };
  }
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
