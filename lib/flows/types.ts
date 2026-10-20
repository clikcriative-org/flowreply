/**
 * Flow graph — the document the visual builder edits and the engine runs.
 *
 * Nodes are steps; edges connect a node's output handle to the next step.
 * Handles per node type:
 *   trigger    → "next"
 *   message    → "next" (no reply buttons) or one handle per reply button id
 *   wait_reply → "reply" | "timeout"
 *   condition  → "yes" | "no"
 *   action     → "next"
 *   delay      → "next"
 * The shape matches React Flow's nodes/edges so the editor stores it as is.
 */

import { z } from "zod";

// Meta caps: button template text 640 chars, 3 buttons, 20-char titles.
export const MAX_MESSAGE_TEXT = 640;
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
// Instagram's standard messaging window. A wait longer than this would wake up
// with no way to message the person.
export const MAX_WAIT_MINUTES = 24 * 60;
export const MAX_NODES = 100;

const position = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const buttonSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("reply"), title: z.string() }),
  z.object({ id, kind: z.literal("url"), title: z.string(), url: z.string() }),
]);
export type FlowButton = z.infer<typeof buttonSchema>;

const triggerNode = z.object({
  id,
  type: z.literal("trigger"),
  position,
  data: z.object({
    keywords: z.array(z.string().max(50)).max(20),
    wholeWord: z.boolean().default(true),
    onComment: z.boolean().default(true),
    onDm: z.boolean().default(false),
    // Restrict comment triggers to one post. Empty means any post.
    postId: z.string().max(64).nullable().optional(),
    // Optional public reply under the comment that started the run.
    publicReply: z.string().max(1000).nullable().optional(),
  }),
});

const messageNode = z.object({
  id,
  type: z.literal("message"),
  position,
  data: z.object({
    text: z.string(),
    buttons: z.array(buttonSchema).default([]),
  }),
});

const waitReplyNode = z.object({
  id,
  type: z.literal("wait_reply"),
  position,
  data: z.object({
    // Variable the reply is saved to, usable as {name} in later messages.
    saveAs: z.string().max(32).regex(/^[a-z0-9_]*$/).default(""),
    timeoutMinutes: z.number().int().min(1).max(MAX_WAIT_MINUTES).default(60),
  }),
});

const conditionRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reply_contains"), value: z.string().max(50) }),
  z.object({ kind: z.literal("has_tag"), value: z.string().max(50) }),
]);
export type ConditionRule = z.infer<typeof conditionRule>;

const conditionNode = z.object({
  id,
  type: z.literal("condition"),
  position,
  data: z.object({
    match: z.enum(["all", "any"]).default("any"),
    rules: z.array(conditionRule).max(10),
  }),
});

const actionNode = z.object({
  id,
  type: z.literal("action"),
  position,
  data: z.object({
    addTags: z.array(z.string().max(50)).max(10).default([]),
    removeTags: z.array(z.string().max(50)).max(10).default([]),
    // POSTs the contact and run variables, e.g. to n8n, Make or a CRM.
    webhookUrl: z.string().max(500).nullable().optional(),
  }),
});

const delayNode = z.object({
  id,
  type: z.literal("delay"),
  position,
  data: z.object({
    minutes: z.number().int().min(1).max(MAX_WAIT_MINUTES),
  }),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
  triggerNode,
  messageNode,
  waitReplyNode,
  conditionNode,
  actionNode,
  delayNode,
]);
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowNodeType = FlowNode["type"];
export type NodeOf<T extends FlowNodeType> = Extract<FlowNode, { type: T }>;

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: id,
  sourceHandle: z.string().max(64).nullable().optional(),
  target: id,
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema).max(MAX_NODES),
  edges: z.array(flowEdgeSchema).max(MAX_NODES * 4),
});
export type FlowGraph = z.infer<typeof flowGraphSchema>;

/** Output handles a node exposes, in display order. */
export function nodeHandles(node: FlowNode): string[] {
  switch (node.type) {
    case "message": {
      const replies = node.data.buttons.filter((b) => b.kind === "reply");
      return replies.length ? replies.map((b) => b.id) : ["next"];
    }
    case "wait_reply":
      return ["reply", "timeout"];
    case "condition":
      return ["yes", "no"];
    default:
      return ["next"];
  }
}

export function handleOf(edge: Pick<FlowEdge, "sourceHandle">): string {
  return edge.sourceHandle || "next";
}

export interface GraphIssue {
  nodeId?: string;
  message: string;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Problems that would stop a flow from running correctly. An empty list means
 * the graph can be published. Messages are English source strings so the UI
 * can translate them.
 */
export function validateGraph(graph: FlowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (byId.size !== graph.nodes.length) {
    issues.push({ message: "Two steps share the same id" });
  }

  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) {
    issues.push({ message: "A flow needs exactly one trigger" });
  }

  for (const node of graph.nodes) {
    switch (node.type) {
      case "trigger": {
        if (!node.data.keywords.some((k) => k.trim())) {
          issues.push({ nodeId: node.id, message: "Add at least one keyword" });
        }
        if (!node.data.onComment && !node.data.onDm) {
          issues.push({
            nodeId: node.id,
            message: "Choose comments, DMs or both as the trigger",
          });
        }
        break;
      }
      case "message": {
        const text = node.data.text.trim();
        if (!text) {
          issues.push({ nodeId: node.id, message: "Message text is empty" });
        } else if (text.length > MAX_MESSAGE_TEXT) {
          issues.push({
            nodeId: node.id,
            message: "Message text is over 640 characters",
          });
        }
        if (node.data.buttons.length > MAX_BUTTONS) {
          issues.push({ nodeId: node.id, message: "Use at most 3 buttons" });
        }
        const buttonIds = new Set<string>();
        for (const button of node.data.buttons) {
          if (buttonIds.has(button.id)) {
            issues.push({ nodeId: node.id, message: "Two buttons share the same id" });
          }
          buttonIds.add(button.id);
          const title = button.title.trim();
          if (!title || title.length > MAX_BUTTON_TITLE) {
            issues.push({
              nodeId: node.id,
              message: "Button titles need 1 to 20 characters",
            });
          }
          if (button.kind === "url" && !isHttpsUrl(button.url)) {
            issues.push({
              nodeId: node.id,
              message: "Link buttons need an https:// address",
            });
          }
        }
        break;
      }
      case "condition": {
        if (!node.data.rules.some((r) => r.value.trim())) {
          issues.push({ nodeId: node.id, message: "Add at least one rule" });
        }
        break;
      }
      case "action": {
        const { addTags, removeTags, webhookUrl } = node.data;
        if (webhookUrl && !isHttpsUrl(webhookUrl)) {
          issues.push({
            nodeId: node.id,
            message: "The webhook needs an https:// address",
          });
        }
        if (!addTags.length && !removeTags.length && !webhookUrl) {
          issues.push({ nodeId: node.id, message: "This action does nothing" });
        }
        break;
      }
      default:
        break;
    }
  }

  const seenHandles = new Set<string>();
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    if (!source || !byId.has(edge.target)) {
      issues.push({ message: "A connection points to a missing step" });
      continue;
    }
    if (byId.get(edge.target)?.type === "trigger") {
      issues.push({ nodeId: edge.source, message: "Nothing can connect into the trigger" });
    }
    const handle = handleOf(edge);
    if (!nodeHandles(source).includes(handle)) {
      issues.push({ nodeId: source.id, message: "A connection leaves from an unknown output" });
    }
    const key = `${edge.source}:${handle}`;
    if (seenHandles.has(key)) {
      issues.push({
        nodeId: source.id,
        message: "Each output can connect to only one step",
      });
    }
    seenHandles.add(key);
  }

  const trigger = triggers[0];
  if (trigger && !graph.edges.some((e) => e.source === trigger.id)) {
    issues.push({ nodeId: trigger.id, message: "Connect the trigger to a first step" });
  }

  // A step nothing leads to would never run; it is almost always a forgotten
  // connection, so publishing it would silently drop part of the conversation.
  if (trigger) {
    const reached = new Set([trigger.id]);
    const queue = [trigger.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        if (edge.source === current && !reached.has(edge.target)) {
          reached.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!reached.has(node.id)) {
        issues.push({ nodeId: node.id, message: "This step is not connected to the flow" });
      }
    }
  }

  return issues;
}

/** Starting graph for a new flow: trigger → message. */
export function starterGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: {
          keywords: [],
          wholeWord: true,
          onComment: true,
          onDm: false,
          postId: null,
          publicReply: null,
        },
      },
      {
        id: "msg1",
        type: "message",
        position: { x: 0, y: 180 },
        data: { text: "", buttons: [] },
      },
    ],
    edges: [{ id: "e-trigger-msg1", source: "trigger", sourceHandle: "next", target: "msg1" }],
  };
}
