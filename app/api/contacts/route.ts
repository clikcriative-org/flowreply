import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { flowAccess } from "@/lib/flows/api";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const access = await flowAccess(false);
  if ("response" in access) return access.response;

  const params = request.nextUrl.searchParams;
  const search = params.get("search")?.trim() ?? "";
  const channel = params.get("channel");
  const tag = params.get("tag")?.trim() ?? "";

  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: access.context.workspaceId,
      ...(channel === "INSTAGRAM" || channel === "WHATSAPP" ? { channel } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { externalId: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      channel: true,
      externalId: true,
      name: true,
      tags: true,
      lastInboundAt: true,
      updatedAt: true,
      _count: { select: { runs: true } },
      runs: {
        where: { status: { in: ["WAITING", "FAILED"] } },
        select: { status: true },
      },
    },
  });

  return NextResponse.json({
    success: true,
    data: contacts.map(({ runs, _count, ...contact }) => ({
      ...contact,
      runCount: _count.runs,
      waiting: runs.filter((r) => r.status === "WAITING").length,
      failed: runs.filter((r) => r.status === "FAILED").length,
    })),
  });
}
