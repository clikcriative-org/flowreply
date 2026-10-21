import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { processWhatsAppWebhook } from "@/lib/whatsapp/process-webhook";
import { verifyWhatsAppSignature, whatsAppVerifyToken } from "@/lib/whatsapp/webhook";

// Meta's subscription check: echo the challenge when the token matches.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = whatsAppVerifyToken();
  if (
    params.get("hub.mode") === "subscribe" &&
    expected &&
    params.get("hub.verify_token") === expected
  ) {
    return new NextResponse(params.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ success: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWhatsAppSignature(rawBody, signature)) {
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "WhatsApp webhook signature verification failed",
          payload: { hadSignatureHeader: Boolean(signature), bodyLength: rawBody.length },
        },
      })
      .catch(() => {});
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await processWhatsAppWebhook(payload as Parameters<typeof processWhatsAppWebhook>[0]);
    return NextResponse.json({ success: true });
  } catch {
    // A 500 makes Meta retry the delivery; job ids make the retry harmless.
    return NextResponse.json({ success: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
