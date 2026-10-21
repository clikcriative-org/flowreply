import { describe, expect, it } from "vitest";
import { buildWhatsAppMessage } from "../lib/whatsapp/client";
import { parseWhatsAppEvents } from "../lib/whatsapp/webhook";

type Payload = Parameters<typeof parseWhatsAppEvents>[0];

function payload(messages: object[], phoneNumberId = "pn1"): Payload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: "5511999990000", profile: { name: "Ana" } }],
              messages,
            },
          },
        ],
      },
    ],
  } as Payload;
}

describe("WhatsApp webhook parsing", () => {
  it("reads text messages with the sender's profile name", () => {
    expect(
      parseWhatsAppEvents(payload([{ id: "w1", from: "5511999990000", type: "text", text: { body: " oi " } }]))
    ).toEqual([
      { phoneNumberId: "pn1", from: "5511999990000", name: "Ana", messageId: "w1", kind: "text", text: "oi" },
    ]);
  });

  it("reads reply-button taps with their payload", () => {
    const [event] = parseWhatsAppEvents(
      payload([
        {
          id: "w2",
          from: "5511999990000",
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "flow:run1:b1", title: "Quero" } },
        },
      ])
    );
    expect(event).toMatchObject({ kind: "button", payload: "flow:run1:b1", text: "Quero" });
  });

  it("ignores status updates, media and other objects", () => {
    expect(parseWhatsAppEvents(payload([{ id: "w3", from: "1", type: "image" }]))).toEqual([]);
    expect(parseWhatsAppEvents({ object: "instagram", entry: [] })).toEqual([]);
    const statusOnly = payload([]);
    expect(parseWhatsAppEvents(statusOnly)).toEqual([]);
  });
});

describe("WhatsApp message building", () => {
  it("sends plain text when there are no buttons", () => {
    expect(buildWhatsAppMessage("55", "Olá", [])).toMatchObject({ type: "text", text: { body: "Olá" } });
  });

  it("uses reply buttons and moves links into the body", () => {
    const message = buildWhatsAppMessage("55", "Escolha", [
      { type: "postback", title: "Preço", payload: "flow:r:a" },
      { type: "web_url", title: "Site", url: "https://x.com" },
    ]);
    expect(message).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Escolha\n\nSite: https://x.com" },
        action: { buttons: [{ type: "reply", reply: { id: "flow:r:a", title: "Preço" } }] },
      },
    });
  });

  it("uses a CTA button for a single link", () => {
    expect(
      buildWhatsAppMessage("55", "Veja", [{ type: "web_url", title: "Abrir", url: "https://x.com" }])
    ).toMatchObject({
      type: "interactive",
      interactive: { type: "cta_url", action: { parameters: { display_text: "Abrir", url: "https://x.com" } } },
    });
  });
});
