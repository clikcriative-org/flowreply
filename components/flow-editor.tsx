"use client";

/**
 * Flow Editor
 *
 * React Flow canvas over the FlowGraph document (lib/flows/types.ts). Each
 * canvas node carries its FlowNode in `data.step`; edges map one to one.
 * Saving writes the draft; publishing makes the worker run it.
 */

import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import {
  MAX_BUTTONS,
  nodeHandles,
  type FlowButton,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type FlowNodeType,
  type GraphIssue,
} from "@/lib/flows/types";

type StepData = { step: FlowNode; issue: boolean };
type CanvasNode = Node<StepData, "step">;

const TYPE_LABELS: Record<FlowNodeType, StaticMessageKey> = {
  trigger: "Trigger",
  message: "Message",
  wait_reply: "Wait for reply",
  condition: "Condition",
  action: "Action",
  delay: "Delay",
};

const HANDLE_LABELS: Record<string, StaticMessageKey> = {
  next: "Next",
  reply: "Replied",
  timeout: "No reply",
  yes: "Yes",
  no: "No",
};

const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40";

function newId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

function blankStep(type: Exclude<FlowNodeType, "trigger">, position: { x: number; y: number }): FlowNode {
  const id = newId(type.slice(0, 3));
  switch (type) {
    case "message":
      return { id, type, position, data: { text: "", buttons: [] } };
    case "wait_reply":
      return { id, type, position, data: { saveAs: "", timeoutMinutes: 60 } };
    case "condition":
      return { id, type, position, data: { match: "any", rules: [{ kind: "reply_contains", value: "" }] } };
    case "action":
      return { id, type, position, data: { addTags: [], removeTags: [], webhookUrl: null } };
    case "delay":
      return { id, type, position, data: { minutes: 10 } };
  }
}

function toCanvas(graph: FlowGraph, issues: GraphIssue[]) {
  const flagged = new Set(issues.map((i) => i.nodeId).filter(Boolean));
  const nodes: CanvasNode[] = graph.nodes.map((step) => ({
    id: step.id,
    type: "step",
    position: step.position,
    data: { step, issue: flagged.has(step.id) },
    deletable: step.type !== "trigger",
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle ?? "next",
    target: e.target,
  }));
  return { nodes, edges };
}

function fromCanvas(nodes: CanvasNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({ ...n.data.step, position: n.position }) as FlowNode),
    edges: edges.map(
      (e): FlowEdge => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? "next",
        target: e.target,
      })
    ),
  };
}

function summary(step: FlowNode, t: (key: StaticMessageKey) => string): string {
  switch (step.type) {
    case "trigger":
      return step.data.keywords.filter(Boolean).join(", ") || t("No keywords yet");
    case "message":
      return step.data.text || t("Empty message");
    case "wait_reply":
      return `${step.data.timeoutMinutes} min`;
    case "condition":
      return step.data.rules.map((r) => r.value).filter(Boolean).join(step.data.match === "all" ? " + " : " / ");
    case "action":
      return [...step.data.addTags.map((x) => `+${x}`), ...step.data.removeTags.map((x) => `-${x}`), step.data.webhookUrl ? "webhook" : ""]
        .filter(Boolean)
        .join(" ");
    case "delay":
      return `${step.data.minutes} min`;
  }
}

function StepNode({ data, selected }: NodeProps<CanvasNode>) {
  const { t } = useI18n();
  const { step, issue } = data;
  const handles = nodeHandles(step);
  const labelFor = (handle: string) => {
    if (step.type === "message" && handle !== "next") {
      return step.data.buttons.find((b) => b.id === handle)?.title || "…";
    }
    return HANDLE_LABELS[handle] ? t(HANDLE_LABELS[handle]) : handle;
  };

  return (
    <div
      className={`w-60 rounded-lg border bg-background shadow-sm ${
        selected ? "border-accent" : issue ? "border-error/60" : "border-border"
      }`}
    >
      {step.type !== "trigger" && <Handle type="target" position={Position.Top} />}
      <div
        className={`rounded-t-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
          step.type === "trigger" ? "bg-accent/15 text-accent" : "bg-surface text-muted"
        }`}
      >
        {t(TYPE_LABELS[step.type])}
      </div>
      <div className="line-clamp-3 px-3 py-2 text-sm text-foreground break-words">
        {summary(step, t)}
      </div>
      <div className="flex justify-around gap-1 px-2 pb-2">
        {handles.map((handle) => (
          // The label truncates in its own span: overflow on this wrapper would
          // clip the handle and make the output impossible to connect.
          <div key={handle} className="relative min-w-0 flex-1 text-center text-[10px] text-muted">
            <span className="block truncate">
              {handles.length > 1 || handle !== "next" ? labelFor(handle) : ""}
            </span>
            <Handle
              id={handle}
              type="source"
              position={Position.Bottom}
              style={{ left: "50%", bottom: -10 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { step: StepNode };

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Inspector({
  step,
  onChange,
}: {
  step: FlowNode;
  onChange: (step: FlowNode) => void;
}) {
  const { t } = useI18n();

  switch (step.type) {
    case "trigger": {
      const d = step.data;
      const set = (patch: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...patch } });
      return (
        <div className="space-y-4">
          <Field label={t("Keywords (comma separated)")}>
            <input
              className={INPUT}
              defaultValue={d.keywords.join(", ")}
              onBlur={(e) => set({ keywords: splitList(e.target.value) })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.wholeWord} onChange={(e) => set({ wholeWord: e.target.checked })} />
            {t("Whole word only")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.onComment} onChange={(e) => set({ onComment: e.target.checked })} />
            {t("Start on comments")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.onDm} onChange={(e) => set({ onDm: e.target.checked })} />
            {t("Start on DMs and Story replies")}
          </label>
          <Field label={t("Only this post ID (optional)")}>
            <input
              className={INPUT}
              defaultValue={d.postId ?? ""}
              onBlur={(e) => set({ postId: e.target.value.trim() || null })}
            />
          </Field>
          <Field label={t("Public reply under the comment (optional)")}>
            <textarea
              className={INPUT}
              rows={2}
              defaultValue={d.publicReply ?? ""}
              onBlur={(e) => set({ publicReply: e.target.value.trim() || null })}
            />
          </Field>
        </div>
      );
    }

    case "message": {
      const d = step.data;
      const setButtons = (buttons: FlowButton[]) => onChange({ ...step, data: { ...d, buttons } });
      return (
        <div className="space-y-4">
          <Field label={t("Message")}>
            <textarea
              className={INPUT}
              rows={5}
              maxLength={640}
              value={d.text}
              onChange={(e) => onChange({ ...step, data: { ...d, text: e.target.value } })}
            />
          </Field>
          <p className="text-xs text-muted">{t("Personalize with placeholders:")} {"{username}"}, {"{city}"}</p>
          {d.buttons.map((button, index) => (
            <div key={button.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <select
                  className={INPUT}
                  value={button.kind}
                  onChange={(e) => {
                    const next = [...d.buttons];
                    next[index] =
                      e.target.value === "url"
                        ? { id: button.id, kind: "url", title: button.title, url: "https://" }
                        : { id: button.id, kind: "reply", title: button.title };
                    setButtons(next);
                  }}
                >
                  <option value="reply">{t("Reply button")}</option>
                  <option value="url">{t("Link button")}</option>
                </select>
                <button
                  type="button"
                  className="text-xs text-error"
                  onClick={() => setButtons(d.buttons.filter((b) => b.id !== button.id))}
                >
                  {t("Remove")}
                </button>
              </div>
              <input
                className={INPUT}
                maxLength={20}
                placeholder={t("Button title")}
                value={button.title}
                onChange={(e) => {
                  const next = [...d.buttons];
                  next[index] = { ...button, title: e.target.value };
                  setButtons(next);
                }}
              />
              {button.kind === "url" && (
                <input
                  className={INPUT}
                  placeholder="https://"
                  value={button.url}
                  onChange={(e) => {
                    const next = [...d.buttons];
                    next[index] = { ...button, url: e.target.value };
                    setButtons(next);
                  }}
                />
              )}
            </div>
          ))}
          {d.buttons.length < MAX_BUTTONS && (
            <button
              type="button"
              className="text-sm font-medium text-accent"
              onClick={() => setButtons([...d.buttons, { id: newId("b"), kind: "reply", title: "" }])}
            >
              + {t("Add button")}
            </button>
          )}
          <p className="text-xs text-muted">
            {t("Reply buttons branch the flow. Link buttons open a page and do not branch.")}
          </p>
        </div>
      );
    }

    case "wait_reply": {
      const d = step.data;
      return (
        <div className="space-y-4">
          <Field label={t("Save the answer as (optional)")}>
            <input
              className={INPUT}
              placeholder="city"
              value={d.saveAs}
              onChange={(e) =>
                onChange({
                  ...step,
                  data: { ...d, saveAs: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32) },
                })
              }
            />
          </Field>
          <Field label={t("Give up after (minutes)")}>
            <input
              type="number"
              min={1}
              max={1440}
              className={INPUT}
              value={d.timeoutMinutes}
              onChange={(e) =>
                onChange({ ...step, data: { ...d, timeoutMinutes: Math.min(1440, Math.max(1, Number(e.target.value) || 1)) } })
              }
            />
          </Field>
        </div>
      );
    }

    case "condition": {
      const d = step.data;
      return (
        <div className="space-y-4">
          <Field label={t("Pass when")}>
            <select
              className={INPUT}
              value={d.match}
              onChange={(e) => onChange({ ...step, data: { ...d, match: e.target.value as "all" | "any" } })}
            >
              <option value="any">{t("Any rule matches")}</option>
              <option value="all">{t("All rules match")}</option>
            </select>
          </Field>
          {d.rules.map((rule, index) => (
            <div key={index} className="flex gap-2">
              <select
                className={INPUT}
                value={rule.kind}
                onChange={(e) => {
                  const rules = [...d.rules];
                  rules[index] = { kind: e.target.value as "reply_contains" | "has_tag", value: rule.value };
                  onChange({ ...step, data: { ...d, rules } });
                }}
              >
                <option value="reply_contains">{t("Last reply contains")}</option>
                <option value="has_tag">{t("Contact has tag")}</option>
              </select>
              <input
                className={INPUT}
                value={rule.value}
                onChange={(e) => {
                  const rules = [...d.rules];
                  rules[index] = { ...rule, value: e.target.value };
                  onChange({ ...step, data: { ...d, rules } });
                }}
              />
              <button
                type="button"
                className="text-xs text-error"
                onClick={() => onChange({ ...step, data: { ...d, rules: d.rules.filter((_, i) => i !== index) } })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-medium text-accent"
            onClick={() => onChange({ ...step, data: { ...d, rules: [...d.rules, { kind: "reply_contains", value: "" }] } })}
          >
            + {t("Add rule")}
          </button>
        </div>
      );
    }

    case "action": {
      const d = step.data;
      return (
        <div className="space-y-4">
          <Field label={t("Add tags (comma separated)")}>
            <input
              className={INPUT}
              defaultValue={d.addTags.join(", ")}
              onBlur={(e) => onChange({ ...step, data: { ...d, addTags: splitList(e.target.value) } })}
            />
          </Field>
          <Field label={t("Remove tags (comma separated)")}>
            <input
              className={INPUT}
              defaultValue={d.removeTags.join(", ")}
              onBlur={(e) => onChange({ ...step, data: { ...d, removeTags: splitList(e.target.value) } })}
            />
          </Field>
          <Field label={t("Send to webhook (optional)")}>
            <input
              className={INPUT}
              placeholder="https://"
              defaultValue={d.webhookUrl ?? ""}
              onBlur={(e) => onChange({ ...step, data: { ...d, webhookUrl: e.target.value.trim() || null } })}
            />
          </Field>
          <p className="text-xs text-muted">
            {t("The webhook receives the contact, tags and saved answers as JSON (n8n, Make, CRM).")}
          </p>
        </div>
      );
    }

    case "delay": {
      const d = step.data;
      return (
        <Field label={t("Wait (minutes)")}>
          <input
            type="number"
            min={1}
            max={1440}
            className={INPUT}
            value={d.minutes}
            onChange={(e) =>
              onChange({ ...step, data: { minutes: Math.min(1440, Math.max(1, Number(e.target.value) || 1)) } })
            }
          />
        </Field>
      );
    }
  }
}

export interface FlowEditorProps {
  flowId: string;
  initialName: string;
  initialGraph: FlowGraph;
  initialIssues: GraphIssue[];
  initialActive: boolean;
  accountUsername: string;
}

export default function FlowEditor({
  flowId,
  initialName,
  initialGraph,
  initialIssues,
  initialActive,
  accountUsername,
}: FlowEditorProps) {
  const { t } = useI18n();
  const initial = useMemo(() => toCanvas(initialGraph, initialIssues), [initialGraph, initialIssues]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [issues, setIssues] = useState<GraphIssue[]>(initialIssues);
  const [active, setActive] = useState(initialActive);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = nodes.find((n) => n.id === selectedId)?.data.step ?? null;

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge(
          { ...connection, id: newId("e") },
          // One step per output: a new connection replaces the old one.
          current.filter(
            (e) => !(e.source === connection.source && (e.sourceHandle ?? "next") === (connection.sourceHandle ?? "next"))
          )
        )
      ),
    [setEdges]
  );

  const updateStep = useCallback(
    (step: FlowNode) => {
      setNodes((current) =>
        current.map((n) => (n.id === step.id ? { ...n, data: { ...n.data, step } } : n))
      );
      // Drop connections from outputs the step no longer has (a removed button).
      const handles = nodeHandles(step);
      setEdges((current) =>
        current.filter((e) => e.source !== step.id || handles.includes(e.sourceHandle ?? "next"))
      );
    },
    [setNodes, setEdges]
  );

  function addStep(type: Exclude<FlowNodeType, "trigger">) {
    const anchor = nodes.find((n) => n.id === selectedId) ?? nodes[nodes.length - 1];
    const position = anchor
      ? { x: anchor.position.x + 40, y: anchor.position.y + 200 }
      : { x: 0, y: 0 };
    const step = blankStep(type, position);
    setNodes((current) => [
      ...current.map((n) => ({ ...n, selected: false })),
      { id: step.id, type: "step", position, data: { step, issue: false }, selected: true },
    ]);
    setSelectedId(step.id);
  }

  function markIssues(next: GraphIssue[]) {
    setIssues(next);
    const flagged = new Set(next.map((i) => i.nodeId).filter(Boolean));
    setNodes((current) => current.map((n) => ({ ...n, data: { ...n.data, issue: flagged.has(n.id) } })));
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/flows/${flowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, graph: fromCanvas(nodes, edges) }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!json?.success) {
      setStatus(t("Could not save the flow"));
      return false;
    }
    markIssues(json.data.issues);
    setStatus(t("Saved"));
    return true;
  }

  async function publish(nextActive: boolean) {
    if (nextActive && !(await save())) return;
    setBusy(true);
    const res = await fetch(`/api/flows/${flowId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nextActive }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!json?.success) {
      if (json?.issues) markIssues(json.issues);
      setStatus(t("Fix the flow before publishing"));
      return;
    }
    setActive(nextActive);
    setStatus(nextActive ? t("Published — the flow is live") : t("Flow turned off"));
  }

  const palette: Exclude<FlowNodeType, "trigger">[] = ["message", "wait_reply", "condition", "action", "delay"];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-foreground hover:border-border focus:border-accent/40 outline-none"
          />
          <span className="shrink-0 text-sm text-muted">@{accountUsername}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && <span className="text-sm text-muted">{status}</span>}
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-border-hover disabled:opacity-50"
          >
            {t("Save draft")}
          </button>
          {active ? (
            <>
              <button
                onClick={() => void publish(true)}
                disabled={busy}
                className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {t("Publish changes")}
              </button>
              <button
                onClick={() => void publish(false)}
                disabled={busy}
                className="rounded border border-border px-4 py-2 text-sm font-medium text-error disabled:opacity-50"
              >
                {t("Turn off")}
              </button>
            </>
          ) : (
            <button
              onClick={() => void publish(true)}
              disabled={busy}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {t("Publish")}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {palette.map((type) => (
          <button
            key={type}
            onClick={() => addStep(type)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/40"
          >
            + {t(TYPE_LABELS[type])}
          </button>
        ))}
      </div>

      {issues.length > 0 && (
        <ul className="panel rounded border-error/30 p-3 text-sm text-error space-y-1">
          {issues.map((issue, i) => (
            <li key={i}>
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => issue.nodeId && setSelectedId(issue.nodeId)}
              >
                • {t(issue.message as StaticMessageKey)}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="panel h-[70vh] min-h-[420px] flex-1 overflow-hidden rounded">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            // Without a cap a two-step flow is zoomed so far in that new steps
            // land off screen.
            fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="panel w-full shrink-0 rounded p-4 lg:w-80">
          {selected ? (
            <>
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t(TYPE_LABELS[selected.type])}</h2>
              {/* key remounts uncontrolled inputs when another step is selected */}
              <Inspector key={selected.id} step={selected} onChange={updateStep} />
            </>
          ) : (
            <p className="text-sm text-muted">
              {t("Select a step to edit it. Drag from an output dot to another step to connect them.")}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
