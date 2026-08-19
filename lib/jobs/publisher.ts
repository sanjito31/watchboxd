import {
  SCRAPE_QUEUE_MESSAGE_VERSION,
  SCRAPE_QUEUE_RETENTION_SECONDS,
  SCRAPE_QUEUE_TOPIC,
  buildCanonicalResourceKey,
  type JobEnvironment,
  type JobIdentity,
  type JobType,
  type ScrapeQueueMessageV1,
} from "./contracts";
import { sanitizeJobFailure } from "./errors";
import {
  createOrReuseJob,
  recordPublicationFailed,
  recordPublicationSucceeded,
  type CreateOrReuseJobResult,
  type JobClient,
  type JobRecord,
} from "./repository";

export type QueueSend = (
  topic: string,
  payload: ScrapeQueueMessageV1,
  options: { idempotencyKey: string; retentionSeconds: number }
) => Promise<{ messageId: string | null }>;

export interface EnqueueJobOptions {
  client?: JobClient;
  send?: QueueSend;
  now?: Date;
}

export interface EnqueueJobResult extends CreateOrReuseJobResult {
  published: boolean;
}

export async function enqueueScrapeJob(
  identity: JobIdentity,
  options: EnqueueJobOptions = {}
): Promise<EnqueueJobResult> {
  const result = await createOrReuseJob(identity, {
    client: options.client,
    now: options.now,
  });

  if (!result.shouldPublish) {
    return { ...result, published: false };
  }

  const job = await publishScrapeJob(result.job, options);
  return { ...result, job, published: true };
}

export async function requestScrapeJob<TType extends JobType>(
  input: {
    environment?: JobEnvironment;
    type: TType;
    identifier: string;
  },
  options: EnqueueJobOptions = {}
): Promise<EnqueueJobResult> {
  return enqueueScrapeJob(
    {
      environment: input.environment ?? getJobEnvironment(),
      type: input.type,
      resourceKey: buildCanonicalResourceKey(input.type, input.identifier),
    },
    options
  );
}

export async function publishScrapeJob(
  job: JobRecord,
  options: Pick<EnqueueJobOptions, "client" | "send"> = {}
): Promise<JobRecord> {
  // Loading the SDK only when a message is actually published avoids creating
  // its default client during Next.js build-time route analysis.
  const send = options.send ?? (await import("@vercel/queue")).send;

  try {
    const { messageId } = await send(
      SCRAPE_QUEUE_TOPIC,
      {
        version: SCRAPE_QUEUE_MESSAGE_VERSION,
        jobId: job.id,
      },
      {
        idempotencyKey: job.id,
        retentionSeconds: SCRAPE_QUEUE_RETENTION_SECONDS,
      }
    );

    const updated = await recordPublicationSucceeded(
      job.id,
      messageId,
      options.client
    );
    return updated ?? job;
  } catch (error) {
    // A lost response can make a safe republish hit the idempotency window.
    // The original message remains deliverable, so this is publication success.
    const { DuplicateMessageError } = await import("@vercel/queue");
    if (error instanceof DuplicateMessageError) {
      const updated = await recordPublicationSucceeded(
        job.id,
        null,
        options.client
      );
      return updated ?? job;
    }

    const failure = sanitizeJobFailure(
      "upstream_unavailable",
      error instanceof Error ? error.message : "Queue publication failed"
    );
    const failed = await recordPublicationFailed(job.id, failure, options.client);
    throw new QueuePublicationError(failed ?? job, { cause: error });
  }
}

export function getJobEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): JobEnvironment {
  const vercelEnvironment = environment.VERCEL_ENV;
  if (
    vercelEnvironment === "development" ||
    vercelEnvironment === "preview" ||
    vercelEnvironment === "production"
  ) {
    return vercelEnvironment;
  }
  return environment.NODE_ENV === "production" ? "production" : "development";
}

export class QueuePublicationError extends Error {
  readonly job: JobRecord;

  constructor(job: JobRecord, options?: ErrorOptions) {
    super("Failed to publish scrape job", options);
    this.name = "QueuePublicationError";
    this.job = job;
  }
}
