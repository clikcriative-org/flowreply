import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { flowAccess, jsonError } from "@/lib/flows/api";
import { starterGraph } from "@/lib/flows/types";

export const dynamic = "force-dynamic";

const createFlowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  instagramAccountId: z.string().min(1),
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
      instagramAccount: { select: { id: true, username: true } },
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
    data: flows.map((flow) => ({ ...flow, runs: runs[flow.id] ?? {} })),
  });
}

export async function POST(request: NextRequest) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;

  const parsed = createFlowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid flow", 400);

  const account = await prisma.instagramAccount.findFirst({
    where: {
      id: parsed.data.instagramAccountId,
      workspaceId: access.context.workspaceId,
    },
    select: { id: true },
  });
  if (!account) return jsonError("Instagram account not found", 404);

  const flow = await prisma.flow.create({
    data: {
      workspaceId: access.context.workspaceId,
      instagramAccountId: account.id,
      name: parsed.data.name,
      graph: starterGraph(),
    },
    select: { id: true },
  });

  return NextResponse.json({ success: true, data: flow }, { status: 201 });
}
