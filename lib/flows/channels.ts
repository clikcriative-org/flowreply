/**
 * Channel adapters for the flow runner. A flow talks to one connected account
 * — an Instagram account or a WhatsApp number — and everything channel
 * specific (how to send, rate limits, public replies) lives here so the runner
 * stays the same for both.
 */

import { prisma } from "@/lib/db/client";
import {
  createInstagramContext,
  hasInstagramCredentials,
  sendCommentReply,
  sendFlowMessage,
  type InstagramContext,
} from "@/lib/instagram/provider";
import { decryptToken } from "@/lib/meta/oauth";
import type { TemplateButton } from "@/lib/meta/client";
import { releaseDMSlot, reserveDMSlot } from "@/lib/utils/rate-limiter";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";

export type FlowChannel = "INSTAGRAM" | "WHATSAPP";

export type Recipient = { userId: string } | { commentId: string; postId?: string };

export interface ChannelAccount {
  channel: FlowChannel;
  // InstagramAccount or WhatsAppAccount row id.
  rowId: string;
  workspaceId: string;
  // Instagram id or WhatsApp phone number id: the business side of a contact.
  ref: string;
  send(recipient: Recipient, text: string, buttons: TemplateButton[], operationId: string): Promise<void>;
  publicReply(commentId: string, text: string, postId: string | undefined, operationId: string): Promise<void>;
}

/** Prisma filter for the flows that belong to this account. */
export function flowAccountWhere(account: Pick<ChannelAccount, "channel" | "rowId">) {
  return account.channel === "WHATSAPP"
    ? { whatsappAccountId: account.rowId }
    : { instagramAccountId: account.rowId };
}

const instagramSelect = {
  id: true,
  workspaceId: true,
  instagramId: true,
  provider: true,
  zernioAccountId: true,
  accessToken: true,
} as const;

const whatsappSelect = {
  id: true,
  workspaceId: true,
  phoneNumberId: true,
  accessToken: true,
} as const;

type InstagramRow = {
  id: string;
  workspaceId: string;
  instagramId: string;
  provider: "META" | "ZERNIO";
  zernioAccountId: string | null;
  accessToken: string;
};

type WhatsAppRow = { id: string; workspaceId: string; phoneNumberId: string; accessToken: string };

function instagramAdapter(row: InstagramRow): ChannelAccount | null {
  if (!hasInstagramCredentials(row)) return null;
  const contexts = new Map<string, Promise<InstagramContext>>();
  const context = (operationId: string) => {
    if (!contexts.has(operationId)) contexts.set(operationId, createInstagramContext(row, operationId));
    return contexts.get(operationId)!;
  };
  return {
    channel: "INSTAGRAM",
    rowId: row.id,
    workspaceId: row.workspaceId,
    ref: row.instagramId,
    async send(recipient, text, buttons, operationId) {
      // Instagram caps private replies at 750 per hour per account.
      const slot = await reserveDMSlot(row.instagramId);
      if (!slot.allowed) throw new Error("Hourly DM limit reached; message not sent");
      try {
        await sendFlowMessage({
          context: await context(operationId),
          instagramAccountId: row.instagramId,
          recipient,
          text,
          buttons,
        });
      } catch (error) {
        await releaseDMSlot(row.instagramId);
        throw error;
      }
    },
    async publicReply(commentId, text, postId, operationId) {
      await sendCommentReply({ context: await context(operationId), commentId, message: text, postId });
    },
  };
}

function whatsappAdapter(row: WhatsAppRow): ChannelAccount {
  return {
    channel: "WHATSAPP",
    rowId: row.id,
    workspaceId: row.workspaceId,
    ref: row.phoneNumberId,
    async send(recipient, text, buttons) {
      if (!("userId" in recipient)) throw new Error("WhatsApp has no comment replies");
      await sendWhatsAppMessage(decryptToken(row.accessToken), row.phoneNumberId, recipient.userId, text, buttons);
    },
    async publicReply() {
      // WhatsApp has no public comments; flows never ask for one there.
    },
  };
}

export async function loadChannelAccount(
  channel: FlowChannel,
  rowId: string
): Promise<ChannelAccount | null> {
  if (channel === "WHATSAPP") {
    const row = await prisma.whatsAppAccount.findUnique({ where: { id: rowId }, select: whatsappSelect });
    return row ? whatsappAdapter(row) : null;
  }
  const row = await prisma.instagramAccount.findUnique({ where: { id: rowId }, select: instagramSelect });
  return row ? instagramAdapter(row) : null;
}

/** The account a flow runs on, whichever channel it is. */
export async function loadFlowAccount(flow: {
  channel: FlowChannel;
  instagramAccountId: string | null;
  whatsappAccountId: string | null;
}): Promise<ChannelAccount | null> {
  const rowId = flow.channel === "WHATSAPP" ? flow.whatsappAccountId : flow.instagramAccountId;
  return rowId ? loadChannelAccount(flow.channel, rowId) : null;
}
