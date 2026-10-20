/**
 * Flow queue — separate from dm-processing so a slow or failing flow never
 * delays campaign DMs, and so flow jobs can run with their own retry policy.
 */

import { Queue } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";

export const FLOW_QUEUE_NAME = "flow-runs";
export const FLOW_EVENT_JOB = "flow-event";
export const FLOW_TIMEOUT_JOB = "flow-timeout";

// Postback payloads for reply buttons: flow:<runId>:<buttonId>. Run ids are
// cuids and button ids are [A-Za-z0-9_-], so neither contains a colon.
export const FLOW_POSTBACK_PREFIX = "flow:";

export interface FlowEventJob {
  // InstagramAccount row id (not the Instagram id).
  accountConnectionId: string;
  instagramAccountId: string;
  source: "comment" | "dm" | "postback";
  senderId: string;
  senderName?: string;
  text?: string;
  commentId?: string;
  mediaId?: string;
  originalMediaId?: string;
  payload?: string;
  // Comment id, message id or postback mid. A redelivered webhook carries the
  // same ref, so it can never start a second run.
  eventRef: string;
}

export interface FlowTimeoutJob {
  runId: string;
  token: number;
}

export type FlowJob = FlowEventJob | FlowTimeoutJob;

let flowQueue: Queue<FlowJob> | null = null;

export function getFlowQueue(): Queue<FlowJob> {
  if (!flowQueue) {
    flowQueue = new Queue<FlowJob>(FLOW_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { age: 24 * 3600, count: 2000 },
        // The runner saves the run before sending, so a retry would never
        // resend a DM — but it would also not deliver one that failed. One
        // attempt keeps the behaviour simple: a failure is recorded on the run.
        attempts: 1,
      },
    });
  }
  return flowQueue;
}

/** BullMQ job ids may not contain ":"; base64url keeps them unique. */
export function flowJobId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${Buffer.from(parts.join("|")).toString("base64url")}`;
}

export function buildFlowPostback(runId: string, buttonId: string): string {
  return `${FLOW_POSTBACK_PREFIX}${runId}:${buttonId}`;
}

export function parseFlowPostback(
  payload: string
): { runId: string; buttonId: string } | null {
  if (!payload.startsWith(FLOW_POSTBACK_PREFIX)) return null;
  const [runId, buttonId] = payload.slice(FLOW_POSTBACK_PREFIX.length).split(":");
  return runId && buttonId ? { runId, buttonId } : null;
}
