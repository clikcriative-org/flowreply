import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp webhooks are signed with the secret of the Meta app that owns the
 * subscription. FlowReply may use a separate app for WhatsApp, so its secret
 * can be set on its own; otherwise the main app secret is used.
 */
export function verifyWhatsAppSignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  const secrets = [process.env.WHATSAPP_APP_SECRET, process.env.FACEBOOK_APP_SECRET].filter(
    (s): s is string => Boolean(s)
  );
  if (!secrets.length) {
    throw new Error("WHATSAPP_APP_SECRET or FACEBOOK_APP_SECRET is required to verify webhooks");
  }
  return secrets.some((secret) => {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export function whatsAppVerifyToken(): string | undefined {
  return process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN;
}

export interface WhatsAppInboundEvent {
  phoneNumberId: string;
  from: string;
  name?: string;
  messageId: string;
  // "text" for typed messages; "button" for a tapped reply button, whose id
  // is in `payload` (our flow:<runId>:<buttonId>).
  kind: "text" | "button";
  text: string;
  payload?: string;
}

interface WhatsAppPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
          button?: { payload?: string; text?: string };
        }[];
      };
    }[];
  }[];
}

/**
 * Inbound customer messages. Status updates (sent, delivered, read) and
 * unsupported types (media, location, reactions) are dropped: flows only
 * act on text and button taps.
 */
export function parseWhatsAppEvents(payload: WhatsAppPayload): WhatsAppInboundEvent[] {
  const events: WhatsAppInboundEvent[] = [];
  if (payload.object !== "whatsapp_business_account") return events;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const names = new Map(
        (value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name] as const)
      );

      for (const message of value?.messages ?? []) {
        if (!message.id || !message.from) continue;
        const name = names.get(message.from) ?? undefined;
        const base = { phoneNumberId, from: message.from, name, messageId: message.id };

        if (message.type === "text" && message.text?.body?.trim()) {
          events.push({ ...base, kind: "text", text: message.text.body.trim() });
        } else if (message.type === "interactive") {
          const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
          if (reply?.id) {
            events.push({ ...base, kind: "button", text: reply.title ?? "", payload: reply.id });
          }
        } else if (message.type === "button" && message.button) {
          // Quick reply on a template message: no flow payload, treat as text.
          const text = message.button.text ?? message.button.payload ?? "";
          if (text.trim()) events.push({ ...base, kind: "text", text: text.trim() });
        }
      }
    }
  }
  return events;
}
