import { prisma } from "@/lib/db/client";
import { FLOW_EVENT_JOB, flowJobId, getFlowQueue, parseFlowPostback } from "@/lib/flows/queue";
import { parseWhatsAppEvents } from "./webhook";

type WhatsAppPayload = Parameters<typeof parseWhatsAppEvents>[0];

/**
 * Queue a flow event for every inbound WhatsApp message on a connected number.
 * Messages for numbers this instance does not know are ignored, so a WABA
 * shared with another system only drives flows for numbers connected here.
 */
export async function processWhatsAppWebhook(payload: WhatsAppPayload): Promise<number> {
  const events = parseWhatsAppEvents(payload);
  if (!events.length) return 0;

  const accounts = await prisma.whatsAppAccount.findMany({
    where: { phoneNumberId: { in: [...new Set(events.map((e) => e.phoneNumberId))] } },
    select: { id: true, phoneNumberId: true },
  });
  const byPhone = new Map(accounts.map((a) => [a.phoneNumberId, a.id]));
  const queue = getFlowQueue();
  let queued = 0;

  for (const event of events) {
    const accountConnectionId = byPhone.get(event.phoneNumberId);
    if (!accountConnectionId) continue;
    const isFlowButton = event.kind === "button" && event.payload && parseFlowPostback(event.payload);

    await queue.add(
      FLOW_EVENT_JOB,
      {
        channel: "WHATSAPP",
        accountConnectionId,
        instagramAccountId: event.phoneNumberId,
        source: isFlowButton ? "postback" : "dm",
        senderId: event.from,
        senderName: event.name,
        text: event.text,
        ...(isFlowButton ? { payload: event.payload } : {}),
        eventRef: `whatsapp:${event.messageId}`,
      },
      { jobId: flowJobId("flowwa", event.phoneNumberId, event.messageId) }
    );
    queued++;
  }
  return queued;
}
