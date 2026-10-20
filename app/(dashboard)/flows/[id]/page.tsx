"use client";

import { useI18n } from "@/lib/i18n/provider";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import FlowEditor, { type FlowEditorProps } from "@/components/flow-editor";
import { flowGraphSchema } from "@/lib/flows/types";

type RouteProps = { params: Promise<{ id: string }> };

export default function FlowEditorPage({ params }: RouteProps) {
  const { id } = use(params);
  const { t } = useI18n();
  const [props, setProps] = useState<FlowEditorProps | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/flows/${id}`);
      const json = await res.json().catch(() => null);
      const graph = flowGraphSchema.safeParse(json?.data?.graph);
      if (cancelled) return;
      if (!json?.success || !graph.success) {
        setError(true);
        return;
      }
      setProps({
        flowId: id,
        initialName: json.data.name,
        initialGraph: graph.data,
        initialIssues: json.data.issues ?? [],
        initialActive: json.data.isActive,
        accountUsername: json.data.instagramAccount.username,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-4">
      <Link href="/flows" className="text-sm text-muted hover:text-foreground">
        ← {t("Flows")}
      </Link>
      {error && <p className="text-sm text-error">{t("Flow not found")}</p>}
      {!error && !props && <p className="text-sm text-muted">{t("Loading…")}</p>}
      {props && <FlowEditor {...props} />}
    </div>
  );
}
