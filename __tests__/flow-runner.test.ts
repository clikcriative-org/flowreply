import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../app/generated/prisma/client";
import type { FlowGraph } from "../lib/flows/types";

const { mockPrisma, mockSendFlowMessage, mockSendCommentReply, mockReserveDMSlot, mockReleaseDMSlot, mockQueueAdd } =
  vi.hoisted(() => ({
    mockPrisma: {
      instagramAccount: { findUnique: vi.fn() },
      contact: { upsert: vi.fn(), update: vi.fn() },
      flow: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
      flowRun: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
    mockSendFlowMessage: vi.fn(),
    mockSendCommentReply: vi.fn(),
    mockReserveDMSlot: vi.fn(),
    mockReleaseDMSlot: vi.fn(),
    mockQueueAdd: vi.fn(),
  }));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: vi.fn(async () => ({ provider: "META", accessToken: "token" })),
  hasInstagramCredentials: () => true,
  sendFlowMessage: mockSendFlowMessage,
  sendCommentReply: mockSendCommentReply,
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mockReserveDMSlot,
  releaseDMSlot: mockReleaseDMSlot,
}));
vi.mock("@/lib/flows/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/flows/queue")>()),
  getFlowQueue: () => ({ add: mockQueueAdd }),
}));

import { handleFlowEvent } from "../lib/flows/runner";

const at = { x: 0, y: 0 };
const graph: FlowGraph = {
  nodes: [
    {
      id: "t",
      type: "trigger",
      position: at,
      data: { keywords: ["link"], wholeWord: true, onComment: true, onDm: true, postId: null, publicReply: "Enviado!" },
    },
    {
      id: "menu",
      type: "message",
      position: at,
      data: { text: "Oi {username}", buttons: [{ id: "a", kind: "reply", title: "Quero" }] },
    },
    { id: "done", type: "message", position: at, data: { text: "Aqui: x.com", buttons: [] } },
  ],
  edges: [
    { id: "1", source: "t", sourceHandle: "next", target: "menu" },
    { id: "2", source: "menu", sourceHandle: "a", target: "done" },
  ],
};

const account = {
  id: "acc-row",
  workspaceId: "ws",
  instagramId: "ig-biz",
  provider: "META",
  zernioAccountId: null,
  accessToken: "enc",
};
const contact = {
  id: "contact-1",
  workspaceId: "ws",
  channel: "INSTAGRAM",
  externalId: "user-1",
  name: "ana",
  tags: [],
  fields: {},
  lastInboundAt: null,
};

const commentJob = {
  accountConnectionId: "acc-row",
  instagramAccountId: "ig-biz",
  source: "comment" as const,
  senderId: "user-1",
  senderName: "ana",
  text: "quero o link",
  commentId: "c1",
  mediaId: "m1",
  eventRef: "comment:c1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findUnique.mockResolvedValue(account);
  mockPrisma.contact.upsert.mockResolvedValue(contact);
  mockPrisma.flow.count.mockResolvedValue(1);
  mockPrisma.flow.findMany.mockResolvedValue([{ id: "flow-1", publishedGraph: graph }]);
  mockPrisma.flow.findUnique.mockResolvedValue({ publishedGraph: graph, isActive: true });
  mockPrisma.flowRun.findFirst.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  mockPrisma.flowRun.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.flowRun.create.mockResolvedValue({ id: "run-1" });
  mockReserveDMSlot.mockResolvedValue({ allowed: true });
  mockSendFlowMessage.mockResolvedValue({ message_id: "mid" });
});

describe("flow runner", () => {
  it("starts a flow from a comment: public reply plus one private reply with a postback button", async () => {
    await handleFlowEvent(commentJob);

    expect(mockPrisma.flowRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowId: "flow-1",
        contactId: "contact-1",
        triggerRef: "comment:c1",
        originCommentId: "c1",
        status: "WAITING",
      }),
    });
    expect(mockSendCommentReply).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "c1", message: "Enviado!" })
    );
    expect(mockSendFlowMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        recipient: { commentId: "c1", postId: "m1" },
        text: "Oi ana",
        buttons: [{ type: "postback", title: "Quero", payload: "flow:run-1:a" }],
      })
    );
  });

  it("records nothing for accounts with no live flow", async () => {
    mockPrisma.flow.count.mockResolvedValue(0);
    await handleFlowEvent(commentJob);
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
    expect(mockSendFlowMessage).not.toHaveBeenCalled();
  });

  it("does nothing when the same comment is delivered twice", async () => {
    mockPrisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" })
    );
    await handleFlowEvent(commentJob);
    expect(mockSendFlowMessage).not.toHaveBeenCalled();
    expect(mockSendCommentReply).not.toHaveBeenCalled();
  });

  it("resumes a waiting run on a button tap and DMs the person directly", async () => {
    mockPrisma.flowRun.findUnique.mockResolvedValue({
      id: "run-1",
      flowId: "flow-1",
      contactId: "contact-1",
      status: "WAITING",
      originCommentId: "c1",
      version: 0,
      state: { nodeId: "menu", waitingFor: "buttons", waitToken: 0, vars: { username: "ana" }, privateReplyUsed: true },
    });

    await handleFlowEvent({
      accountConnectionId: "acc-row",
      instagramAccountId: "ig-biz",
      source: "postback",
      senderId: "user-1",
      payload: "flow:run-1:a",
      eventRef: "postback:mid-1",
    });

    expect(mockPrisma.flowRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", version: 0, status: "WAITING" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    expect(mockSendFlowMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ recipient: { userId: "user-1" }, text: "Aqui: x.com", buttons: [] })
    );
  });

  it("ignores a postback for someone else's run", async () => {
    mockPrisma.flowRun.findUnique.mockResolvedValue({
      id: "run-1",
      contactId: "someone-else",
      status: "WAITING",
    });
    await handleFlowEvent({
      accountConnectionId: "acc-row",
      instagramAccountId: "ig-biz",
      source: "postback",
      senderId: "user-1",
      payload: "flow:run-1:a",
      eventRef: "postback:mid-2",
    });
    expect(mockPrisma.flowRun.updateMany).not.toHaveBeenCalled();
    expect(mockSendFlowMessage).not.toHaveBeenCalled();
  });

  it("marks the run failed and sends nothing when the hourly DM limit is hit", async () => {
    mockReserveDMSlot.mockResolvedValue({ allowed: false });
    await handleFlowEvent(commentJob);
    expect(mockSendFlowMessage).not.toHaveBeenCalled();
    expect(mockPrisma.flowRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("releases the rate-limit slot when Instagram rejects the message", async () => {
    mockSendFlowMessage.mockRejectedValue(new Error("window closed"));
    await handleFlowEvent(commentJob);
    expect(mockReleaseDMSlot).toHaveBeenCalledWith("ig-biz");
  });
});
