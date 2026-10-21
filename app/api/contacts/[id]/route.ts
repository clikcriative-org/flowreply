import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { flowAccess, jsonError } from "@/lib/flows/api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const HISTORY_LIMIT = 200;

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const access = await flowAccess(false);
  if ("response" in access) return access.response;
  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: access.context.workspaceId },
    select: {
      id: true,
      channel: true,
      externalId: true,
      accountRef: true,
      name: true,
      tags: true,
      fields: true,
      lastInboundAt: true,
      createdAt: true,
      runs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
          flow: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!contact) return jsonError("Contact not found", 404);

  // Newest first from the database, oldest first on screen like a chat.
  const events = await prisma.contactEvent.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, direction: true, kind: true, text: true, createdAt: true, runId: true },
  });

  return NextResponse.json({ success: true, data: { ...contact, events: events.reverse() } });
}

const updateSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(50)).max(50),
});

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid tags", 400);

  const tags = [...new Map(parsed.data.tags.map((t) => [t.toLowerCase(), t])).values()];
  const updated = await prisma.contact.updateMany({
    where: { id, workspaceId: access.context.workspaceId },
    data: { tags },
  });
  if (!updated.count) return jsonError("Contact not found", 404);
  return NextResponse.json({ success: true, data: { tags } });
}
