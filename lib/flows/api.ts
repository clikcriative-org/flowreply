import { NextResponse } from "next/server";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspace-access";

export function jsonError(error: string, status: number, extra?: object) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/**
 * Workspace context for a flow route, or the error response to return.
 * Reading is open to every member; changing flows needs owner or admin, the
 * same rule campaigns follow.
 */
export async function flowAccess(
  write: boolean
): Promise<{ context: WorkspaceContext } | { response: NextResponse }> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { response: jsonError("Unauthorized", 401) };
  if (write && !canManageWorkspace(context.role)) {
    return { response: jsonError("Only owners and admins can change flows", 403) };
  }
  return { context };
}

/** "@username" or the phone number, for lists and the editor header. */
export function flowAccountLabel(flow: {
  instagramAccount: { username: string } | null;
  whatsappAccount: { displayPhone: string } | null;
}): string {
  if (flow.whatsappAccount) return flow.whatsappAccount.displayPhone;
  return flow.instagramAccount ? `@${flow.instagramAccount.username}` : "";
}
