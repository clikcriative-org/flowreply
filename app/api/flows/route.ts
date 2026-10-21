import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { flowAccess, flowAccountLabel, jsonError } from "@/lib/flows/api";
import { starterGraph } from "@/lib/flows/types";

export const dynamic = "force-dynamic";

const createFlowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  channel: z.enum(["INSTAGRAM", "WHATSAPP"]).default("INSTAGRAM"),
  accountId: z.string().min(1),
});


export async function GET() {
  const access = await flowAccess(false);
  if ("response" in access) return access.response;

  const flows = await prisma.flow.findMany({
    where: { workspaceId: access.context.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      isActive: true,
      publishedAt: true,
      updatedAt: true,
      channel: true,
      instagramAccount: { select: { username: true } },
      whatsappAccount: { select: { displayPhone: true } },
    },
  });

  const counts = await prisma.flowRun.groupBy({
    by: ["flowId", "status"],
    where: { flowId: { in: flows.map((f) => f.id) } },
    _count: { _all: true },
  });
  const runs: Record<string, Record<string, number>> = {};
  for (const row of counts) {
    (runs[row.flowId] ??= {})[row.status] = row._count._all;
  }

  return NextResponse.json({
    success: true,
    data: flows.map(({ instagramAccount, whatsappAccount, ...flow }) => ({
      ...flow,
      accountLabel: flowAccountLabel({ instagramAccount, whatsappAccount }),
      runs: runs[flow.id] ?? {},
    })),
  });
}

export async function POST(request: NextRequest) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;

  const parsed = createFlowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid flow", 400);

  const { name, channel, accountId } = parsed.data;
  const where = { id: accountId, workspaceId: access.context.workspaceId };
  const account =
    channel === "WHATSAPP"
      ? await prisma.whatsAppAccount.findFirst({ where, select: { id: true } })
      : await prisma.instagramAccount.findFirst({ where, select: { id: true } });
  if (!account) return jsonError("Account not found", 404);

  const flow = await prisma.flow.create({
    data: {
      workspaceId: access.context.workspaceId,
      channel,
      ...(channel === "WHATSAPP"
        ? { whatsappAccountId: account.id }
        : { instagramAccountId: account.id }),
      name,
      graph: starterGraph(channel),
    },
    select: { id: true },
  });

  return NextResponse.json({ success: true, data: flow }, { status: 201 });
}
