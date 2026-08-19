import { QueueClient } from "@vercel/queue";
import {
  processScrapeQueueMessage,
  queueRetryDirective,
} from "@/lib/jobs/consumer";

export const runtime = "nodejs";
export const maxDuration = 300;

const queue = new QueueClient({
  // Vercel sets VERCEL_REGION at runtime. The fallback keeps build-time route
  // analysis deterministic; callback events still carry their queue region.
  region: process.env.VERCEL_REGION ?? "iad1",
});

const handleScrapeQueueCallback = queue.handleCallback(
  processScrapeQueueMessage,
  {
    visibilityTimeoutSeconds: 300,
    retry: queueRetryDirective,
  }
);

export function POST(request: Request): Promise<Response> {
  return handleScrapeQueueCallback(request);
}
