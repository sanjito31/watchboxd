import "server-only";

import {
  type JobType,
} from "@/lib/jobs/contracts";
import {
  QueuePublicationError,
  requestScrapeJob,
} from "@/lib/jobs/publisher";
import { getJobById, type JobRecord } from "@/lib/jobs/repository";
import type {
  JobGateway,
  StoredJobRecord,
} from "@/lib/api/types";

/**
 * Agent C's owned boundary around Agent A's atomic create/reuse/publish API.
 */
export class QueueJobGateway implements JobGateway {
  async ensureJob(type: JobType, identifier: string): Promise<StoredJobRecord> {
    try {
      const result = await requestScrapeJob({ type, identifier });
      return mapJob(result.job);
    } catch (error) {
      // Publication failures are already persisted on the job. Return that
      // durable status so stale resources can still be served and misses can
      // produce a standardized API error instead of an opaque 500.
      if (error instanceof QueuePublicationError) {
        return mapJob(error.job);
      }
      throw error;
    }
  }

  async getJob(id: string): Promise<StoredJobRecord | null> {
    const job = await getJobById(id);
    return job ? mapJob(job) : null;
  }
}

function mapJob(job: JobRecord): StoredJobRecord {
  return {
    id: job.id,
    type: job.type,
    resourceKey: job.resourceKey,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorCode: job.error?.code ?? null,
  };
}
