"use client";

/**
 * WhatsApp Connection
 *
 * Connects WhatsApp Business numbers (Cloud API) with a System User token.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";

interface WhatsAppNumber {
  id: string;
  phoneNumberId: string;
  displayPhone: string;
  verifiedName: string | null;
}

const INPUT =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

export function WhatsAppConnection({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const json = await fetch("/api/whatsapp/accounts")
        .then((r) => r.json())
        .catch(() => null);
      if (!cancelled && json?.success) setNumbers(json.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const json = await fetch("/api/whatsapp/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumberId, wabaId, accessToken }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(false);
    if (!json?.success) {
      setMessage({ ok: false, text: `${t("Could not connect the number")}${json?.detail ? ` — ${json.detail}` : ""}` });
      return;
    }
    setAccessToken("");
    setPhoneNumberId("");
    setWabaId("");
    setMessage(
      json.data.webhookWarning
        ? { ok: false, text: `${t("Number saved, but the webhook subscription failed")} — ${json.data.webhookWarning}` }
        : { ok: true, text: t("WhatsApp number connected") }
    );
    setReloadKey((k) => k + 1);
  }

  async function disconnect(number: WhatsAppNumber) {
    if (!window.confirm(t("Disconnect this number? Its flows are deleted too."))) return;
    await fetch(`/api/whatsapp/accounts?id=${number.id}`, { method: "DELETE" });
    setReloadKey((k) => k + 1);
  }

  return (
    <section className="panel rounded p-4 sm:p-6 space-y-4">
      <h2 className="text-base font-semibold">{t("WhatsApp Connection")}</h2>

      {numbers.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border">
          {numbers.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{n.displayPhone}</div>
                <div className="truncate text-xs text-muted">
                  {n.verifiedName ?? ""} · ID {n.phoneNumberId}
                </div>
              </div>
              {canManage && (
                <button onClick={() => void disconnect(n)} className="text-xs font-medium text-error">
                  {t("Disconnect")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={connect} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Phone number ID")}
            </span>
            <input className={INPUT} inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value.trim())} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("WhatsApp Business account ID")}
            </span>
            <input className={INPUT} inputMode="numeric" value={wabaId} onChange={(e) => setWabaId(e.target.value.trim())} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Permanent access token (System User)")}
            </span>
            <input className={INPUT} type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={busy || !phoneNumberId || !wabaId || !accessToken}
              className="rounded bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? t("Connecting…") : t("Connect number")}
            </button>
            {message && (
              <span className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</span>
            )}
          </div>
          <p className="text-xs text-muted sm:col-span-2">
            {t("Find the IDs in Meta's WhatsApp Manager under API Setup. The token is checked with Meta and stored encrypted.")}
          </p>
        </form>
      ) : (
        <p className="text-sm text-muted">{t("Only owners and admins can connect numbers.")}</p>
      )}
    </section>
  );
}
