"use client";

/**
 * Contact Detail Page
 *
 * Conversation history (messages in and out, failures) and flow runs for one
 * person, with editable tags.
 */

import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import { use, useEffect, useState } from "react";
import Link from "next/link";

interface ContactEvent {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  kind: string;
  text: string;
  createdAt: string;
}

interface ContactRun {
  id: string;
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  flow: { id: string; name: string };
}

interface ContactDetail {
  id: string;
  channel: "INSTAGRAM" | "WHATSAPP";
  externalId: string;
  name: string | null;
  tags: string[];
  lastInboundAt: string | null;
  createdAt: string;
  runs: ContactRun[];
  events: ContactEvent[];
}

const RUN_STATUS: Record<string, StaticMessageKey> = {
  RUNNING: "Running",
  WAITING: "Waiting",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

type RouteProps = { params: Promise<{ id: string }> };

export default function ContactDetailPage({ params }: RouteProps) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [error, setError] = useState(false);
  const [tagsText, setTagsText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const json = await fetch(`/api/contacts/${id}`)
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled) return;
      if (!json?.success) {
        setError(true);
        return;
      }
      setContact(json.data);
      setTagsText(json.data.tags.join(", "));
      const last = json.data.lastInboundAt ? new Date(json.data.lastInboundAt).getTime() : 0;
      setWindowOpen(Date.now() - last < 24 * 3600 * 1000);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function saveTags() {
    const tags = tagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const json = await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setSaved(json?.success ? t("Changes saved") : t("Could not save the tags"));
    if (json?.success) setTagsText(json.data.tags.join(", "));
  }

  if (error) return <p className="text-sm text-error">{t("Contact not found")}</p>;
  if (!contact) return <p className="text-sm text-muted">{t("Loading…")}</p>;

  return (
    <div className="space-y-6">
      <Link href="/contacts" className="text-sm text-muted hover:text-foreground">
        ← {t("Contacts")}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{contact.name || contact.externalId}</h1>
        <p className="text-sm text-muted">
          {contact.channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} · ID {contact.externalId} ·{" "}
          {windowOpen ? t("24h window open") : t("24h window closed")}
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <section className="panel flex-1 rounded p-4 sm:p-6">
          <h2 className="mb-4 text-base font-semibold">{t("Conversation")}</h2>
          {contact.events.length === 0 && <p className="text-sm text-muted">{t("No messages recorded yet.")}</p>}
          <div className="space-y-2">
            {contact.events.map((event) => {
              const isError = event.kind === "error";
              const outbound = event.direction === "OUTBOUND";
              return (
                <div key={event.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      isError
                        ? "border border-error/30 bg-error/5 text-error"
                        : outbound
                          ? "bg-accent/10 text-foreground"
                          : "bg-surface text-foreground border border-border"
                    }`}
                  >
                    {isError && <span className="font-semibold">{t("Failed")}: </span>}
                    {event.kind === "comment" && <span className="text-xs text-muted">{t("Comment")}: </span>}
                    {event.text}
                    <div className="mt-1 text-[10px] text-muted">{new Date(event.createdAt).toLocaleString(locale)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="w-full shrink-0 space-y-6 lg:w-80">
          <section className="panel rounded p-4 sm:p-6 space-y-3">
            <h2 className="text-base font-semibold">{t("Tags")}</h2>
            <input
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                setSaved(null);
              }}
              placeholder={t("comma separated")}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => void saveTags()}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-hover"
              >
                {t("Save tags")}
              </button>
              {saved && <span className="text-xs text-muted">{saved}</span>}
            </div>
          </section>

          <section className="panel rounded p-4 sm:p-6">
            <h2 className="mb-3 text-base font-semibold">{t("Flow runs")}</h2>
            {contact.runs.length === 0 && <p className="text-sm text-muted">{t("No runs yet.")}</p>}
            <ul className="space-y-3">
              {contact.runs.map((run) => (
                <li key={run.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/flows/${run.flow.id}`} className="truncate font-medium hover:text-accent">
                      {run.flow.name}
                    </Link>
                    <span
                      className={`shrink-0 text-xs ${
                        run.status === "FAILED" ? "text-error" : run.status === "COMPLETED" ? "text-success" : "text-muted"
                      }`}
                    >
                      {RUN_STATUS[run.status] ? t(RUN_STATUS[run.status]) : run.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted">{new Date(run.updatedAt).toLocaleString(locale)}</div>
                  {run.lastError && <div className="mt-1 text-xs text-error break-words">{run.lastError}</div>}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
