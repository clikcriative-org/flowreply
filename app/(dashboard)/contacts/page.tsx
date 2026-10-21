"use client";

/**
 * Contacts Page
 *
 * Everyone who reached a flow, on any channel, with tags and run status.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import Link from "next/link";

interface ContactRow {
  id: string;
  channel: "INSTAGRAM" | "WHATSAPP";
  externalId: string;
  name: string | null;
  tags: string[];
  lastInboundAt: string | null;
  updatedAt: string;
  runCount: number;
  waiting: number;
  failed: number;
}

const CHANNELS = ["ALL", "INSTAGRAM", "WHATSAPP"] as const;

export default function ContactsPage() {
  const { t, locale } = useI18n();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("ALL");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (query) params.set("search", query);
    if (channel !== "ALL") params.set("channel", channel);
    void (async () => {
      const json = await fetch(`/api/contacts?${params}`)
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled) return;
      if (json?.success) setContacts(json.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, channel]);

  const channelLabel = (c: (typeof CHANNELS)[number]) =>
    c === "ALL" ? t("All") : c === "WHATSAPP" ? "WhatsApp" : "Instagram";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("Contacts")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t("Everyone who reached a flow, with their tags and conversation history.")}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search by name or ID")}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
          />
        </form>
        <div className="flex gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                channel === c
                  ? "bg-accent/15 text-accent border border-accent/20"
                  : "bg-surface text-muted border border-border hover:text-foreground"
              }`}
            >
              {channelLabel(c)}
            </button>
          ))}
        </div>
      </div>

      <div className="panel rounded divide-y divide-border">
        {loading && <div className="p-6 text-sm text-muted">{t("Loading…")}</div>}
        {!loading && contacts.length === 0 && (
          <div className="p-6 text-sm text-muted">{t("No contacts yet. They appear when someone reaches a flow.")}</div>
        )}
        {contacts.map((contact) => (
          <Link
            key={contact.id}
            href={`/contacts/${contact.id}`}
            className="flex flex-col gap-2 p-4 hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-foreground">
                  {contact.name || contact.externalId}
                </span>
                <span className="rounded-lg border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
                  {channelLabel(contact.channel)}
                </span>
              </div>
              {contact.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <span key={tag} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
              {contact.failed > 0 && (
                <span className="text-error">{t("{count} failed", { count: contact.failed })}</span>
              )}
              {contact.waiting > 0 && <span>{t("{count} waiting", { count: contact.waiting })}</span>}
              <span>{new Date(contact.updatedAt).toLocaleString(locale)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
