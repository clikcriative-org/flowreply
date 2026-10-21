import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { flowAccess, flowAccountLabel, jsonError } from "@/lib/flows/api";
import { flowGraphSchema, validateGraph } from "@/lib/flows/types";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const updateFlowSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  graph: flowGraphSchema.optional(),
});

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const access = await flowAccess(false);
  if ("response" in access) return access.response;
  const { id } = await params;

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId: access.context.workspaceId },
    select: {
      id: true,
      name: true,
      isActive: true,
      graph: true,
      publishedAt: true,
      updatedAt: true,
      channel: true,
      instagramAccount: { select: { username: true } },
      whatsappAccount: { select: { displayPhone: true } },
    },
  });
  if (!flow) return jsonError("Flow not found", 404);

  const { instagramAccount, whatsappAccount, ...rest } = flow;
  const graph = flowGraphSchema.safeParse(flow.graph);
  return NextResponse.json({
    success: true,
    data: {
      ...rest,
      accountLabel: flowAccountLabel({ instagramAccount, whatsappAccount }),
      issues: graph.success ? validateGraph(graph.data, flow.channel) : [],
    },
  });
}

// Saves the draft. Live runs keep using the published graph until the next
// publish, so saving never changes what the worker executes.
export async function PUT(request: NextRequest, { params }: RouteProps) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;
  const { id } = await params;

  const parsed = updateFlowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Invalid flow", 400, { details: parsed.error.issues.slice(0, 5) });
  }

  const current = await prisma.flow.findFirst({
    where: { id, workspaceId: access.context.workspaceId },
    select: { channel: true },
  });
  if (!current) return jsonError("Flow not found", 404);

  const updated = await prisma.flow.updateMany({
    where: { id, workspaceId: access.context.workspaceId },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.graph ? { graph: parsed.data.graph } : {}),
    },
  });
  if (!updated.count) return jsonError("Flow not found", 404);

  return NextResponse.json({
    success: true,
    data: { issues: parsed.data.graph ? validateGraph(parsed.data.graph, current.channel) : [] },
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;
  const { id } = await params;

  const deleted = await prisma.flow.deleteMany({
    where: { id, workspaceId: access.context.workspaceId },
  });
  if (!deleted.count) return jsonError("Flow not found", 404);
  return NextResponse.json({ success: true });
}
