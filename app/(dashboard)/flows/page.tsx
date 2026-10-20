"use client";

/**
 * Flows List Page
 *
 * Multi-step automations built in the visual editor.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";

interface FlowRow {
  id: string;
  name: string;
  isActive: boolean;
  publishedAt: string | null;
  updatedAt: string;
  instagramAccount: { id: string; username: string };
  runs: Record<string, number>;
}

export default function FlowsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [flowsRes, accountsRes] = await Promise.all([
        fetch("/api/flows"),
        fetch("/api/instagram/accounts"),
      ]);
      const flowsJson = await flowsRes.json().catch(() => null);
      const accountsJson = await accountsRes.json().catch(() => null);
      if (cancelled) return;
      if (flowsJson?.success) setFlows(flowsJson.data);
      if (accountsJson?.success) {
        const list: AccountOption[] = accountsJson.data.instagramAccounts ?? [];
        setAccounts(list);
        setAccountId((current) => current || list[0]?.id || "");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createFlow(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !accountId) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, instagramAccountId: accountId }),
    });
    const json = await res.json().catch(() => null);
    setCreating(false);
    if (!json?.success) {
      setError(t("Could not create the flow"));
      return;
    }
    router.push(`/flows/${json.data.id}`);
  }

  async function deleteFlow(flow: FlowRow) {
    if (!window.confirm(t("Delete this flow? Its history is deleted too."))) return;
    await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
    setFlows((current) => current.filter((f) => f.id !== flow.id));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("Flows")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t("Multi-step conversations: buttons, questions, conditions, tags and delays.")}
        </p>
      </div>

      <form
        onSubmit={createFlow}
        className="panel rounded p-4 sm:p-6 flex flex-col gap-4 lg:flex-row lg:items-end"
      >
        <label className="flex flex-1 flex-col gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {t("Flow name")}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder={t("e.g. Catalog by DM")}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
          />
        </label>
        {accounts.length > 0 && (
          <AccountSelect
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            includeAll={false}
          />
        )}
        <button
          type="submit"
          disabled={creating || !name.trim() || !accountId}
          className="rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {creating ? t("Creating…") : t("New flow")}
        </button>
      </form>
      {!loading && accounts.length === 0 && (
        <p className="text-sm text-muted">
          {t("Connect an Instagram account in Settings before creating a flow.")}
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="panel rounded divide-y divide-border">
        {loading && <div className="p-6 text-sm text-muted">{t("Loading…")}</div>}
        {!loading && flows.length === 0 && (
          <div className="p-6 text-sm text-muted">{t("No flows yet.")}</div>
        )}
        {flows.map((flow) => (
          <div
            key={flow.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/flows/${flow.id}`}
                  className="truncate font-semibold text-foreground hover:text-accent"
                >
                  {flow.name}
                </Link>
                <span
                  className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                    flow.isActive
                      ? "bg-success/10 text-success"
                      : "bg-surface text-muted border border-border"
                  }`}
                >
                  {flow.isActive ? t("Live") : t("Off")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                @{flow.instagramAccount.username} ·{" "}
                {t("{count} completed", { count: flow.runs.COMPLETED ?? 0 })} ·{" "}
                {t("{count} waiting", { count: flow.runs.WAITING ?? 0 })} ·{" "}
                {t("{count} failed", { count: flow.runs.FAILED ?? 0 })}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/flows/${flow.id}`}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-hover"
              >
                {t("Edit")}
              </Link>
              <button
                onClick={() => void deleteFlow(flow)}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-error hover:border-error/40"
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
