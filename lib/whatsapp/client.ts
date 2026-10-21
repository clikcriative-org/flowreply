/**
 * WhatsApp Cloud API client — the few Graph calls FlowReply needs.
 *
 * Message shape rules (Meta):
 * - Reply buttons: interactive "button", at most 3, titles up to 20 chars,
 *   body up to 1024 chars. They cannot be mixed with URL buttons.
 * - URL button: interactive "cta_url", exactly one.
 * So a message with reply buttons sends its links as text in the body, and a
 * message with two or more links (and no reply buttons) sends them as text.
 */

import { getMetaGraphApiVersion } from "@/lib/env";
import type { TemplateButton } from "@/lib/meta/client";

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const MAX_INTERACTIVE_BODY = 1024;
const MAX_TEXT_BODY = 4096;

function graphBase() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

async function graphRequest<T>(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${graphBase()}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
  };
  if (!response.ok || data.error) {
    throw new WhatsAppApiError(
      `${data.error?.message ?? `WhatsApp API error ${response.status}`} (${path.split("?")[0]})`,
      data.error?.code
    );
  }
  return data as T;
}

/** Build the /messages payload for a flow message. Exported for tests. */
export function buildWhatsAppMessage(to: string, text: string, buttons: TemplateButton[]) {
  const replies = buttons.filter((b) => b.type === "postback");
  const links = buttons.filter((b) => b.type === "web_url");
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };

  if (replies.length) {
    const linkLines = links.map((l) => `${l.title}: ${l.url}`);
    const body = [text, ...linkLines].join("\n\n").slice(0, MAX_INTERACTIVE_BODY);
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: {
          buttons: replies.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.payload, title: b.title.slice(0, 20) },
          })),
        },
      },
    };
  }

  if (links.length === 1) {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: text.slice(0, MAX_INTERACTIVE_BODY) },
        action: {
          name: "cta_url",
          parameters: { display_text: links[0].title.slice(0, 20), url: links[0].url },
        },
      },
    };
  }

  const body = [text, ...links.map((l) => `${l.title}: ${l.url}`)].join("\n\n");
  return {
    ...base,
    type: "text",
    text: { body: body.slice(0, MAX_TEXT_BODY), preview_url: links.length > 0 },
  };
}

export async function sendWhatsAppMessage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  text: string,
  buttons: TemplateButton[]
): Promise<{ messageId: string | null }> {
  const result = await graphRequest<{ messages?: { id: string }[] }>(
    accessToken,
    `${encodeURIComponent(phoneNumberId)}/messages`,
    { method: "POST", body: buildWhatsAppMessage(to, text, buttons) }
  );
  return { messageId: result.messages?.[0]?.id ?? null };
}

export async function getPhoneNumber(accessToken: string, phoneNumberId: string) {
  return graphRequest<{ display_phone_number: string; verified_name?: string }>(
    accessToken,
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`
  );
}

/**
 * Subscribe this app to the WhatsApp Business Account so its webhooks reach
 * FlowReply. Several apps can subscribe to the same WABA; each gets its own
 * copy of every event.
 */
export async function subscribeAppToWaba(accessToken: string, wabaId: string) {
  return graphRequest<{ success: boolean }>(
    accessToken,
    `${encodeURIComponent(wabaId)}/subscribed_apps`,
    { method: "POST" }
  );
}
