import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { flowAccess, jsonError } from "@/lib/flows/api";
import { flowGraphSchema, validateGraph } from "@/lib/flows/types";

type RouteProps = { params: Promise<{ id: string }> };

const publishSchema = z.object({ active: z.boolean() });

// active: true publishes the current draft and turns the flow on.
// active: false turns it off; waiting runs stay parked and resume if it is
// turned back on.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const access = await flowAccess(true);
  if ("response" in access) return access.response;
  const { id } = await params;

  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request", 400);

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId: access.context.workspaceId },
    select: { id: true, graph: true },
  });
  if (!flow) return jsonError("Flow not found", 404);

  if (!parsed.data.active) {
    await prisma.flow.update({ where: { id: flow.id }, data: { isActive: false } });
    return NextResponse.json({ success: true, data: { isActive: false } });
  }

  const graph = flowGraphSchema.safeParse(flow.graph);
  if (!graph.success) return jsonError("The saved flow is invalid", 400);
  const issues = validateGraph(graph.data);
  if (issues.length) return jsonError("Fix the flow before publishing", 400, { issues });

  const published = await prisma.flow.update({
    where: { id: flow.id },
    data: { isActive: true, publishedGraph: graph.data, publishedAt: new Date() },
    select: { isActive: true, publishedAt: true },
  });
  return NextResponse.json({ success: true, data: published });
}
