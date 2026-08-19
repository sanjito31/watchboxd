import "server-only";

import { QueueJobGateway } from "@/lib/api/job-gateway";
import { PrismaApiRepository } from "@/lib/api/repository";
import { ApiService } from "@/lib/api/service";

export const apiService = new ApiService(
  new PrismaApiRepository(),
  new QueueJobGateway()
);
