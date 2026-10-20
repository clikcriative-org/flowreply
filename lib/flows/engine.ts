/**
 * Flow engine — pure step function.
 *
 * Given a published graph, the run's saved state and one input (the trigger,
 * a reply, a button tap or a timer), it walks the graph until the run has to
 * wait or ends, and returns the effects to perform. It never touches the
 * database or the network, so lib/flows/runner.ts owns all I/O and this file
 * is fully unit-testable.
 *
 * Instagram messaging rules the engine enforces:
 * - Outside the 24h window (the person has not messaged us), the only allowed
 *   message is one private reply to the comment that started the run.
 * - After that private reply nothing else can be sent until the person
 *   answers, so the run parks on the next message ("window") and resumes the
 *   moment they reply or tap a button.
 */

import { matchKeywords } from "@/lib/utils/keyword-matcher";
import {
  handleOf,
  type FlowButton,
  type FlowGraph,
  type FlowNode,
  type NodeOf,
} from "./types";

// Steps a single input may execute. Guards against a graph that loops through
// conditions and actions without ever waiting.
export const MAX_STEPS_PER_INPUT = 50;

export type WaitKind = "buttons" | "reply" | "delay" | "window";

export interface RunState {
  nodeId: string | null;
  waitingFor: WaitKind | null;
  // Bumped on every timed wait; a timer carrying an older token is stale.
  waitToken: number;
  vars: Record<string, string>;
  privateReplyUsed: boolean;
}

export interface StepContext {
  tags: string[];
  // The person messaged us within the last 24 hours.
  windowOpen: boolean;
  // The run started from a comment, so one private reply is available.
  hasOriginComment: boolean;
}

export type StepInput =
  | { kind: "start"; vars?: Record<string, string> }
  | { kind: "text"; text: string }
  | { kind: "button"; buttonId: string }
  | { kind: "timeout"; token: number };

export type Effect =
  | {
      type: "send";
      nodeId: string;
      text: string;
      buttons: FlowButton[];
      viaComment: boolean;
    }
  | { type: "public_reply"; text: string }
  | { type: "tags"; add: string[]; remove: string[] }
  | { type: "webhook"; url: string; nodeId: string }
  | { type: "schedule"; minutes: number; token: number };

export type StepStatus = "WAITING" | "COMPLETED" | "FAILED" | "IGNORED";

export interface StepResult {
  status: StepStatus;
  state: RunState;
  effects: Effect[];
  tags: string[];
  error?: string;
}

export function initialState(vars: Record<string, string> = {}): RunState {
  return {
    nodeId: null,
    waitingFor: null,
    waitToken: 0,
    vars: { ...vars },
    privateReplyUsed: false,
  };
}

/** Replace {name} placeholders with run variables; unknown ones become "". */
export function personalize(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-z0-9_]+)\}/gi, (_, name: string) => vars[name] ?? "");
}

function nextNode(graph: FlowGraph, from: FlowNode, handle: string): FlowNode | null {
  const edge = graph.edges.find((e) => e.source === from.id && handleOf(e) === handle);
  return edge ? graph.nodes.find((n) => n.id === edge.target) ?? null : null;
}

function evaluateCondition(
  node: NodeOf<"condition">,
  vars: Record<string, string>,
  tags: string[]
): boolean {
  const lowerTags = tags.map((t) => t.toLowerCase());
  const results = node.data.rules
    .filter((rule) => rule.value.trim())
    .map((rule) => {
      if (rule.kind === "has_tag") {
        return lowerTags.includes(rule.value.trim().toLowerCase());
      }
      return matchKeywords(vars.last_reply ?? "", [rule.value], true).matched;
    });
  if (!results.length) return false;
  return node.data.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

function applyTags(tags: string[], add: string[], remove: string[]): string[] {
  const removeSet = new Set(remove.map((t) => t.trim().toLowerCase()));
  const next = tags.filter((t) => !removeSet.has(t.toLowerCase()));
  for (const raw of add) {
    const tag = raw.trim();
    if (tag && !next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
  }
  return next;
}

/**
 * Decide where a waiting run resumes for this input. `undefined` means the
 * input does not concern the run (it stays exactly as it was).
 */
function resumeTarget(
  graph: FlowGraph,
  node: FlowNode,
  state: RunState,
  input: Exclude<StepInput, { kind: "start" }>
): { cursor: FlowNode | null } | undefined {
  switch (state.waitingFor) {
    case "window":
      // Any reply opens the window: re-run the message that was blocked.
      return input.kind === "timeout" ? undefined : { cursor: node };

    case "buttons": {
      if (node.type !== "message") return { cursor: null };
      const replies = node.data.buttons.filter((b) => b.kind === "reply");
      let chosen: FlowButton | undefined;
      if (input.kind === "button") {
        chosen = replies.find((b) => b.id === input.buttonId);
      } else if (input.kind === "text") {
        // Typing the button's label counts as tapping it.
        const typed = input.text.trim().toLowerCase();
        chosen = replies.find((b) => b.title.trim().toLowerCase() === typed);
      }
      if (!chosen) return undefined;
      state.vars.last_reply = chosen.title;
      return { cursor: nextNode(graph, node, chosen.id) };
    }

    case "reply": {
      if (node.type !== "wait_reply") return { cursor: null };
      if (input.kind === "timeout") {
        if (input.token !== state.waitToken) return undefined;
        return { cursor: nextNode(graph, node, "timeout") };
      }
      const text = input.kind === "text" ? input.text : "";
      state.vars.last_reply = text;
      if (node.data.saveAs) state.vars[node.data.saveAs] = text;
      return { cursor: nextNode(graph, node, "reply") };
    }

    case "delay":
      if (input.kind !== "timeout" || input.token !== state.waitToken) return undefined;
      return { cursor: nextNode(graph, node, "next") };

    default:
      return { cursor: null };
  }
}

export function step(
  graph: FlowGraph,
  previous: RunState,
  input: StepInput,
  ctx: StepContext
): StepResult {
  const state: RunState = { ...previous, vars: { ...previous.vars } };
  const effects: Effect[] = [];
  let tags = [...ctx.tags];
  // A reply or a tap is itself an inbound message, so the window is open.
  const windowOpen = ctx.windowOpen || input.kind === "text" || input.kind === "button";

  let cursor: FlowNode | null;

  if (input.kind === "start") {
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    if (!trigger || trigger.type !== "trigger") {
      return { status: "FAILED", state, effects, tags, error: "Flow has no trigger" };
    }
    Object.assign(state, initialState(input.vars));
    const publicReply = trigger.data.publicReply?.trim();
    if (publicReply && ctx.hasOriginComment) {
      effects.push({ type: "public_reply", text: personalize(publicReply, state.vars) });
    }
    cursor = nextNode(graph, trigger, "next");
  } else {
    const node = graph.nodes.find((n) => n.id === state.nodeId);
    if (!node || !state.waitingFor) {
      return { status: "COMPLETED", state, effects, tags };
    }
    const target = resumeTarget(graph, node, state, input);
    if (!target) return { status: "IGNORED", state: previous, effects, tags: ctx.tags };
    cursor = target.cursor;
  }

  const wait = (node: FlowNode, kind: WaitKind): StepResult => {
    state.nodeId = node.id;
    state.waitingFor = kind;
    return { status: "WAITING", state, effects, tags };
  };

  for (let i = 0; i < MAX_STEPS_PER_INPUT; i++) {
    if (!cursor) {
      state.nodeId = null;
      state.waitingFor = null;
      return { status: "COMPLETED", state, effects, tags };
    }
    const node: FlowNode = cursor;

    switch (node.type) {
      case "message": {
        const viaComment = !windowOpen;
        if (viaComment && (!ctx.hasOriginComment || state.privateReplyUsed)) {
          return wait(node, "window");
        }
        if (viaComment) state.privateReplyUsed = true;
        effects.push({
          type: "send",
          nodeId: node.id,
          text: personalize(node.data.text, state.vars),
          buttons: node.data.buttons,
          viaComment,
        });
        if (node.data.buttons.some((b) => b.kind === "reply")) {
          return wait(node, "buttons");
        }
        cursor = nextNode(graph, node, "next");
        break;
      }
      case "wait_reply":
      case "delay": {
        state.waitToken += 1;
        const minutes =
          node.type === "delay" ? node.data.minutes : node.data.timeoutMinutes;
        effects.push({ type: "schedule", minutes, token: state.waitToken });
        return wait(node, node.type === "delay" ? "delay" : "reply");
      }
      case "condition": {
        const passed = evaluateCondition(node, state.vars, tags);
        cursor = nextNode(graph, node, passed ? "yes" : "no");
        break;
      }
      case "action": {
        const { addTags, removeTags, webhookUrl } = node.data;
        if (addTags.length || removeTags.length) {
          tags = applyTags(tags, addTags, removeTags);
          effects.push({ type: "tags", add: addTags, remove: removeTags });
        }
        if (webhookUrl) effects.push({ type: "webhook", url: webhookUrl, nodeId: node.id });
        cursor = nextNode(graph, node, "next");
        break;
      }
      case "trigger":
        cursor = nextNode(graph, node, "next");
        break;
    }
  }

  return {
    status: "FAILED",
    state,
    effects,
    tags,
    error: "The flow loops without waiting for the contact",
  };
}

export interface TriggerEvent {
  source: "comment" | "dm";
  text: string;
  mediaId?: string;
  originalMediaId?: string;
}

/** The keyword that fires this flow for the event, or null. */
export function matchTrigger(graph: FlowGraph, event: TriggerEvent): string | null {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  if (!trigger || trigger.type !== "trigger") return null;
  const { keywords, wholeWord, onComment, onDm, postId } = trigger.data;

  if (event.source === "comment") {
    if (!onComment) return null;
    if (postId && postId !== event.mediaId && postId !== event.originalMediaId) return null;
  } else if (!onDm) {
    return null;
  }

  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  return matchKeywords(event.text, cleaned, wholeWord).matchedKeyword;
}
