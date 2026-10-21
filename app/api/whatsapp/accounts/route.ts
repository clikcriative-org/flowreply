import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { flowAccess, jsonError } from "@/lib/flows/api";
import { encryptToken } from "@/lib/meta/oauth";
import { getPhoneNumber, subscribeAppToWaba, WhatsAppApiError } from "@/lib/whatsapp/client";

export const dynamic = "force-dynamic";

const digits = z.string().trim().regex(/^\d{5,30}$/);
const connectSchema = z.object({
  phoneNumberId: digits,
  wabaId: digits,
  accessToken: z.string().trim().min(20).max(1000),
});

export async function GET() {
  const access = await flowAccess(false);
  if ("response" in access) return access.response;
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { workspaceId: access.context.workspaceId },
    orderBy: { connectedAt: "asc" },
    select: { id: true, phoneNumberId: true, wabaId: true, displayPhone: true, verifiedName: true, connectedAt: true },
  });
  return NextResponse.json({ success: true, data: accounts });
}

// Connects a number with a System User token. The token is checked against the
// number before it is stored, and the app is subscribed to the WABA so its
// webhooks start arriving.
export async function POST(request: NextRequest) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;

  const parsed = connectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the number ID, account ID and token", 400);
  const { phoneNumberId, wabaId, accessToken } = parsed.data;

  let phone: { display_phone_number: string; verified_name?: string };
  try {
    phone = await getPhoneNumber(accessToken, phoneNumberId);
  } catch (error) {
    const detail = error instanceof WhatsAppApiError ? error.message : "unknown error";
    return jsonError("Meta rejected the token or the number ID", 400, { detail });
  }

  const existing = await prisma.whatsAppAccount.findUnique({
    where: { phoneNumberId },
    select: { workspaceId: true },
  });
  if (existing && existing.workspaceId !== access.context.workspaceId) {
    return jsonError("This number is connected to another workspace", 409);
  }

  const data = {
    wabaId,
    displayPhone: phone.display_phone_number,
    verifiedName: phone.verified_name ?? null,
    accessToken: encryptToken(accessToken),
  };
  const account = await prisma.whatsAppAccount.upsert({
    where: { phoneNumberId },
    create: { workspaceId: access.context.workspaceId, phoneNumberId, ...data },
    update: data,
    select: { id: true, displayPhone: true, verifiedName: true },
  });

  let webhookWarning: string | null = null;
  try {
    await subscribeAppToWaba(accessToken, wabaId);
  } catch (error) {
    webhookWarning = error instanceof Error ? error.message : "Subscription failed";
  }

  return NextResponse.json({ success: true, data: { ...account, webhookWarning } }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return jsonError("Missing id", 400);
  const deleted = await prisma.whatsAppAccount.deleteMany({
    where: { id, workspaceId: access.context.workspaceId },
  });
  if (!deleted.count) return jsonError("Number not found", 404);
  return NextResponse.json({ success: true });
}
