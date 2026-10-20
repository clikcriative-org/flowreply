/**
 * Flow runner — the I/O half of the flow engine.
 *
 * Loads the contact and run, asks the pure engine (engine.ts) what to do,
 * saves the new state, then performs the effects. State is saved *before*
 * sending: a crash between the two loses a message rather than sending it
 * twice, which is the safer failure for DMs to real people.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  createInstagramContext,
  hasInstagramCredentials,
  sendCommentReply,
  sendFlowMessage,
  type InstagramContext,
} from "@/lib/instagram/provider";
import type { TemplateButton } from "@/lib/meta/client";
import { releaseDMSlot, reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  matchTrigger,
  step,
  type Effect,
  type RunState,
  type StepInput,
  type StepResult,
} from "./engine";
import {
  buildFlowPostback,
  FLOW_TIMEOUT_JOB,
  flowJobId,
  getFlowQueue,
  parseFlowPostback,
  type FlowEventJob,
  type FlowTimeoutJob,
} from "./queue";
import { flowGraphSchema, type FlowGraph } from "./types";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 5000;
const MAX_LOCK_RETRIES = 3;

type AccountRow = {
  id: string;
  workspaceId: string;
  instagramId: string;
  provider: "META" | "ZERNIO";
  zernioAccountId: string | null;
  accessToken: string;
};

type ContactRow = {
  id: string;
  workspaceId: string;
  channel: "INSTAGRAM" | "WHATSAPP";
  externalId: string;
  name: string | null;
  tags: string[];
  fields: Prisma.JsonValue;
  lastInboundAt: Date | null;
};

type RunRow = {
  id: string;
  flowId: string;
  contactId: string;
  status: string;
  state: Prisma.JsonValue;
  originCommentId: string | null;
  version: number;
};

function windowOpen(contact: Pick<ContactRow, "lastInboundAt">, now = Date.now()) {
  return Boolean(
    contact.lastInboundAt && now - contact.lastInboundAt.getTime() < WINDOW_MS
  );
}

function parseGraph(value: Prisma.JsonValue | null): FlowGraph | null {
  const parsed = flowGraphSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const runStatus = {
  WAITING: "WAITING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

// ─── Entry points ───────────────────────────────────────────────────────────

export async function handleFlowEvent(job: FlowEventJob): Promise<void> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: job.accountConnectionId },
    select: {
      id: true,
      workspaceId: true,
      instagramId: true,
      provider: true,
      zernioAccountId: true,
      accessToken: true,
    },
  });
  if (
    !account ||
    account.instagramId !== job.instagramAccountId ||
    !hasInstagramCredentials(account)
  ) {
    return;
  }

  // Every comment and DM is queued here. Without a live flow there is nothing
  // to start or resume (runs of a turned-off flow stay frozen), so stop before
  // recording a contact for every commenter.
  const liveFlows = await prisma.flow.count({
    where: { instagramAccountId: account.id, isActive: true },
  });
  if (!liveFlows) return;

  const inbound = job.source !== "comment";
  const contact = await prisma.contact.upsert({
    where: {
      workspaceId_channel_accountRef_externalId: {
        workspaceId: account.workspaceId,
        channel: "INSTAGRAM",
        accountRef: account.instagramId,
        externalId: job.senderId,
      },
    },
    create: {
      workspaceId: account.workspaceId,
      channel: "INSTAGRAM",
      accountRef: account.instagramId,
      externalId: job.senderId,
      name: job.senderName ?? null,
      lastInboundAt: inbound ? new Date() : null,
    },
    update: {
      ...(job.senderName ? { name: job.senderName } : {}),
      ...(inbound ? { lastInboundAt: new Date() } : {}),
    },
  });

  if (job.source === "postback") {
    const postback = job.payload ? parseFlowPostback(job.payload) : null;
    if (!postback) return;
    const run = await prisma.flowRun.findUnique({ where: { id: postback.runId } });
    if (!run || run.contactId !== contact.id || run.status !== "WAITING") return;
    await advanceRun(account, contact, run, { kind: "button", buttonId: postback.buttonId });
    return;
  }

  if (job.source === "dm" && job.text) {
    // A person mid-flow is answering that flow, not starting a new one.
    const waiting = await prisma.flowRun.findFirst({
      where: {
        contactId: contact.id,
        status: "WAITING",
        flow: { instagramAccountId: account.id, isActive: true },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (waiting) {
      const result = await advanceRun(account, contact, waiting, {
        kind: "text",
        text: job.text,
      });
      if (result && result.status !== "IGNORED") return;
    }
  }

  await startMatchingFlow(account, contact, job);
}

export async function handleFlowTimeout(job: FlowTimeoutJob): Promise<void> {
  const run = await prisma.flowRun.findUnique({
    where: { id: job.runId },
    include: {
      contact: true,
      flow: {
        select: {
          isActive: true,
          instagramAccount: {
            select: {
              id: true,
              workspaceId: true,
              instagramId: true,
              provider: true,
              zernioAccountId: true,
              accessToken: true,
            },
          },
        },
      },
    },
  });
  if (!run || run.status !== "WAITING" || !run.flow.isActive) return;
  const account = run.flow.instagramAccount;
  if (!hasInstagramCredentials(account)) return;
  await advanceRun(account, run.contact, run, { kind: "timeout", token: job.token });
}

// ─── Starting ───────────────────────────────────────────────────────────────

async function startMatchingFlow(
  account: AccountRow,
  contact: ContactRow,
  job: FlowEventJob
): Promise<void> {
  if (!job.text || job.source === "postback") return;
  const flows = await prisma.flow.findMany({
    where: { instagramAccountId: account.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, publishedGraph: true },
  });

  for (const flow of flows) {
    const graph = parseGraph(flow.publishedGraph);
    if (!graph) continue;
    const keyword = matchTrigger(graph, {
      source: job.source,
      text: job.text,
      mediaId: job.mediaId,
      originalMediaId: job.originalMediaId,
    });
    if (!keyword) continue;

    const originCommentId = job.source === "comment" ? job.commentId ?? null : null;
    const result = step(
      graph,
      { nodeId: null, waitingFor: null, waitToken: 0, vars: {}, privateReplyUsed: false },
      {
        kind: "start",
        vars: { username: job.senderName ?? contact.name ?? "", keyword },
      },
      {
        tags: contact.tags,
        windowOpen: windowOpen(contact),
        hasOriginComment: Boolean(originCommentId),
      }
    );
    if (result.status === "IGNORED") return;

    let runId: string;
    try {
      // Starting again replaces the person's previous unfinished run of this flow.
      const [, created] = await prisma.$transaction([
        prisma.flowRun.updateMany({
          where: { flowId: flow.id, contactId: contact.id, status: { in: ["WAITING", "RUNNING"] } },
          data: { status: "CANCELLED", version: { increment: 1 } },
        }),
        prisma.flowRun.create({
          data: {
            workspaceId: account.workspaceId,
            flowId: flow.id,
            contactId: contact.id,
            triggerRef: job.eventRef,
            originCommentId,
            ...persistedFields(result),
          },
        }),
      ]);
      runId = created.id;
    } catch (error) {
      // Same comment or message delivered twice: the first delivery owns it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    }

    await performEffects({
      account,
      contact,
      runId,
      flowId: flow.id,
      originCommentId,
      mediaId: job.mediaId,
      result,
    });
    // ManyChat semantics: one keyword starts one flow.
    return;
  }
}

// ─── Advancing ──────────────────────────────────────────────────────────────

async function advanceRun(
  account: AccountRow,
  contact: ContactRow,
  initialRun: RunRow,
  input: StepInput
): Promise<StepResult | null> {
  let run = initialRun;
  for (let attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
    const flow = await prisma.flow.findUnique({
      where: { id: run.flowId },
      select: { publishedGraph: true, isActive: true },
    });
    const graph = flow?.isActive ? parseGraph(flow.publishedGraph) : null;
    if (!graph) return null;

    const result = step(graph, run.state as unknown as RunState, input, {
      tags: contact.tags,
      windowOpen: windowOpen(contact),
      hasOriginComment: Boolean(run.originCommentId),
    });
    if (result.status === "IGNORED") return result;

    const saved = await prisma.flowRun.updateMany({
      where: { id: run.id, version: run.version, status: "WAITING" },
      data: { ...persistedFields(result), version: { increment: 1 } },
    });
    if (saved.count === 1) {
      await performEffects({
        account,
        contact,
        runId: run.id,
        flowId: run.flowId,
        originCommentId: run.originCommentId,
        result,
      });
      return result;
    }

    // Another event advanced the run first; re-read and try again.
    const fresh = await prisma.flowRun.findUnique({ where: { id: run.id } });
    if (!fresh || fresh.status !== "WAITING") return null;
    run = fresh;
  }
  return null;
}

function persistedFields(result: StepResult) {
  const schedule = result.effects.find((e) => e.type === "schedule");
  return {
    status: runStatus[result.status as keyof typeof runStatus] ?? "FAILED",
    state: result.state as unknown as Prisma.InputJsonValue,
    waitUntil:
      schedule && schedule.type === "schedule"
        ? new Date(Date.now() + schedule.minutes * 60_000)
        : null,
    lastError: result.error ?? null,
  };
}

// ─── Effects ────────────────────────────────────────────────────────────────

function toTemplateButtons(effect: Extract<Effect, { type: "send" }>, runId: string): TemplateButton[] {
  return effect.buttons.map((b) =>
    b.kind === "reply"
      ? { type: "postback", title: b.title, payload: buildFlowPostback(runId, b.id) }
      : { type: "web_url", title: b.title, url: b.url }
  );
}

async function performEffects({
  account,
  contact,
  runId,
  flowId,
  originCommentId,
  mediaId,
  result,
}: {
  account: AccountRow;
  contact: ContactRow;
  runId: string;
  flowId: string;
  originCommentId: string | null;
  mediaId?: string;
  result: StepResult;
}): Promise<void> {
  if (!result.effects.length) return;

  if (result.effects.some((e) => e.type === "tags")) {
    await prisma.contact.update({ where: { id: contact.id }, data: { tags: result.tags } });
  }

  let context: InstagramContext | null = null;
  const getContext = async () =>
    (context ??= await createInstagramContext(account, `flow:${runId}:${result.state.waitToken}`));

  const errors: string[] = [];

  for (const effect of result.effects) {
    try {
      switch (effect.type) {
        case "send": {
          const slot = await reserveDMSlot(account.instagramId);
          if (!slot.allowed) {
            throw new Error("Hourly DM limit reached; message not sent");
          }
          try {
            await sendFlowMessage({
              context: await getContext(),
              instagramAccountId: account.instagramId,
              recipient:
                effect.viaComment && originCommentId
                  ? { commentId: originCommentId, postId: mediaId }
                  : { userId: contact.externalId },
              text: effect.text,
              buttons: toTemplateButtons(effect, runId),
            });
          } catch (error) {
            await releaseDMSlot(account.instagramId);
            throw error;
          }
          break;
        }
        case "public_reply": {
          if (!originCommentId) break;
          await sendCommentReply({
            context: await getContext(),
            commentId: originCommentId,
            message: effect.text,
            postId: mediaId,
          });
          break;
        }
        case "schedule": {
          await getFlowQueue().add(
            FLOW_TIMEOUT_JOB,
            { runId, token: effect.token },
            {
              delay: effect.minutes * 60_000,
              jobId: flowJobId("flowtimeout", runId, String(effect.token)),
            }
          );
          break;
        }
        case "webhook": {
          await postWebhook(effect.url, {
            event: "flow.action",
            flowId,
            runId,
            nodeId: effect.nodeId,
            contact: {
              id: contact.id,
              channel: contact.channel,
              externalId: contact.externalId,
              name: contact.name,
              tags: result.tags,
              fields: contact.fields,
            },
            vars: result.state.vars,
          });
          break;
        }
        case "tags":
          break;
      }
    } catch (error) {
      errors.push(`${effect.type}: ${errorMessage(error)}`);
      // A message that failed to send leaves the conversation broken, so the
      // rest of this step must not run as if it had arrived.
      if (effect.type === "send") {
        await prisma.flowRun.update({
          where: { id: runId },
          data: { status: "FAILED", lastError: errors.join(" | ").slice(0, 1000) },
        });
        return;
      }
    }
  }

  if (errors.length) {
    await prisma.flowRun.update({
      where: { id: runId },
      data: { lastError: errors.join(" | ").slice(0, 1000) },
    });
  }
}

async function postWebhook(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "FlowReply" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Webhook answered ${response.status}`);
}
