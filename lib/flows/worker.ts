import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";
import { handleFlowEvent, handleFlowTimeout } from "./runner";
import {
  FLOW_QUEUE_NAME,
  FLOW_TIMEOUT_JOB,
  type FlowEventJob,
  type FlowJob,
  type FlowTimeoutJob,
} from "./queue";

async function processFlowJob(job: Job<FlowJob>): Promise<void> {
  if (job.name === FLOW_TIMEOUT_JOB) {
    await handleFlowTimeout(job.data as FlowTimeoutJob);
  } else {
    await handleFlowEvent(job.data as FlowEventJob);
  }
}

export function createFlowWorker(): Worker<FlowJob> {
  const worker = new Worker<FlowJob>(FLOW_QUEUE_NAME, processFlowJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });

  worker.on("failed", (job, err) => {
    console.error(`[Flow Worker] Job ${job?.id} failed:`, err.message);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `Flow job failed: ${err.message}`.slice(0, 1000),
          payload: { jobId: job?.id ?? null, name: job?.name ?? null },
        },
      })
      .catch(() => {});
  });

  worker.on("error", (err) => {
    console.error("[Flow Worker] Worker error:", err.message);
  });

  return worker;
}
