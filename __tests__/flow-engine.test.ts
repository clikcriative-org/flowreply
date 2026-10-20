import { describe, expect, it } from "vitest";
import {
  initialState,
  matchTrigger,
  personalize,
  step,
  type StepContext,
} from "../lib/flows/engine";
import { flowGraphSchema, starterGraph, validateGraph, type FlowGraph } from "../lib/flows/types";

const at = { x: 0, y: 0 };

function graph(input: unknown): FlowGraph {
  return flowGraphSchema.parse(input);
}

const trigger = {
  id: "t",
  type: "trigger",
  position: at,
  data: { keywords: ["link"], onComment: true, onDm: true, publicReply: "Te mandei no direct!" },
};

// trigger → menu (2 reply buttons) → [a] msgA, [b] tag + msgB
const menuFlow = graph({
  nodes: [
    trigger,
    {
      id: "menu",
      type: "message",
      position: at,
      data: {
        text: "Oi {username}, o que você quer?",
        buttons: [
          { id: "a", kind: "reply", title: "Preço" },
          { id: "b", kind: "reply", title: "Catálogo" },
        ],
      },
    },
    { id: "msgA", type: "message", position: at, data: { text: "R$ 99" } },
    { id: "tagB", type: "action", position: at, data: { addTags: ["catalogo"] } },
    {
      id: "msgB",
      type: "message",
      position: at,
      data: { text: "Aqui está", buttons: [{ id: "l", kind: "url", title: "Abrir", url: "https://x.com" }] },
    },
  ],
  edges: [
    { id: "1", source: "t", target: "menu" },
    { id: "2", source: "menu", sourceHandle: "a", target: "msgA" },
    { id: "3", source: "menu", sourceHandle: "b", target: "tagB" },
    { id: "4", source: "tagB", target: "msgB" },
  ],
});

const fromComment: StepContext = { tags: [], windowOpen: false, hasOriginComment: true };

describe("flow engine", () => {
  it("starts from a comment with a public reply and one private reply, then waits for a button", () => {
    const result = step(menuFlow, initialState(), { kind: "start", vars: { username: "ana" } }, fromComment);
    expect(result.status).toBe("WAITING");
    expect(result.state).toMatchObject({ nodeId: "menu", waitingFor: "buttons", privateReplyUsed: true });
    expect(result.effects).toEqual([
      { type: "public_reply", text: "Te mandei no direct!" },
      expect.objectContaining({ type: "send", nodeId: "menu", text: "Oi ana, o que você quer?", viaComment: true }),
    ]);
  });

  it("follows the tapped button and applies tags on the way", () => {
    const started = step(menuFlow, initialState(), { kind: "start" }, fromComment);
    const tapped = step(menuFlow, started.state, { kind: "button", buttonId: "b" }, fromComment);
    expect(tapped.status).toBe("COMPLETED");
    expect(tapped.tags).toEqual(["catalogo"]);
    expect(tapped.effects.map((e) => e.type)).toEqual(["tags", "send"]);
    expect(tapped.effects[1]).toMatchObject({ nodeId: "msgB", viaComment: false });
  });

  it("treats typing a button label as tapping it, and ignores other text", () => {
    const started = step(menuFlow, initialState(), { kind: "start" }, fromComment);
    const other = step(menuFlow, started.state, { kind: "text", text: "oi" }, fromComment);
    expect(other.status).toBe("IGNORED");
    const typed = step(menuFlow, started.state, { kind: "text", text: " preço " }, fromComment);
    expect(typed.status).toBe("COMPLETED");
    expect(typed.effects[0]).toMatchObject({ nodeId: "msgA", text: "R$ 99" });
  });

  it("parks a second message until the person answers when the window is closed", () => {
    const twoMessages = graph({
      nodes: [
        trigger,
        { id: "m1", type: "message", position: at, data: { text: "um" } },
        { id: "m2", type: "message", position: at, data: { text: "dois" } },
      ],
      edges: [
        { id: "1", source: "t", target: "m1" },
        { id: "2", source: "m1", target: "m2" },
      ],
    });
    const started = step(twoMessages, initialState(), { kind: "start" }, fromComment);
    expect(started.state).toMatchObject({ nodeId: "m2", waitingFor: "window" });
    expect(started.effects.filter((e) => e.type === "send")).toHaveLength(1);

    const answered = step(twoMessages, started.state, { kind: "text", text: "ok" }, fromComment);
    expect(answered.status).toBe("COMPLETED");
    expect(answered.effects).toEqual([expect.objectContaining({ nodeId: "m2", viaComment: false })]);
  });

  it("sends a whole DM-started flow in one go while the window is open", () => {
    const result = step(menuFlow, initialState(), { kind: "start" }, {
      tags: [],
      windowOpen: true,
      hasOriginComment: false,
    });
    expect(result.effects).toEqual([expect.objectContaining({ type: "send", viaComment: false })]);
  });

  it("waits for a reply, saves it, branches on it and honours the timeout token", () => {
    const quiz = graph({
      nodes: [
        { ...trigger, data: { ...trigger.data, publicReply: null } },
        { id: "w", type: "wait_reply", position: at, data: { saveAs: "cidade", timeoutMinutes: 30 } },
        { id: "c", type: "condition", position: at, data: { rules: [{ kind: "reply_contains", value: "sp" }] } },
        { id: "yes", type: "message", position: at, data: { text: "Atendemos {cidade}!" } },
        { id: "no", type: "message", position: at, data: { text: "Ainda não" } },
        { id: "late", type: "message", position: at, data: { text: "Ainda aí?" } },
      ],
      edges: [
        { id: "1", source: "t", target: "w" },
        { id: "2", source: "w", sourceHandle: "reply", target: "c" },
        { id: "3", source: "w", sourceHandle: "timeout", target: "late" },
        { id: "4", source: "c", sourceHandle: "yes", target: "yes" },
        { id: "5", source: "c", sourceHandle: "no", target: "no" },
      ],
    });
    const dm: StepContext = { tags: [], windowOpen: true, hasOriginComment: false };
    const started = step(quiz, initialState(), { kind: "start" }, dm);
    expect(started.effects).toEqual([{ type: "schedule", minutes: 30, token: 1 }]);

    const stale = step(quiz, started.state, { kind: "timeout", token: 0 }, dm);
    expect(stale.status).toBe("IGNORED");

    const replied = step(quiz, started.state, { kind: "text", text: "Moro em SP" }, dm);
    expect(replied.effects).toEqual([expect.objectContaining({ text: "Atendemos Moro em SP!" })]);

    const timedOut = step(quiz, started.state, { kind: "timeout", token: 1 }, dm);
    expect(timedOut.effects).toEqual([expect.objectContaining({ nodeId: "late" })]);
  });

  it("fails instead of spinning forever on a loop with no wait", () => {
    const loop = graph({
      nodes: [
        trigger,
        { id: "a1", type: "action", position: at, data: { addTags: ["x"] } },
        { id: "a2", type: "action", position: at, data: { removeTags: ["x"] } },
      ],
      edges: [
        { id: "1", source: "t", target: "a1" },
        { id: "2", source: "a1", target: "a2" },
        { id: "3", source: "a2", target: "a1" },
      ],
    });
    const result = step(loop, initialState(), { kind: "start" }, fromComment);
    expect(result.status).toBe("FAILED");
  });

  it("matches triggers by source, post and keyword", () => {
    const postOnly = graph({
      nodes: [{ ...trigger, data: { ...trigger.data, onDm: false, postId: "p1" } }],
      edges: [],
    });
    expect(matchTrigger(postOnly, { source: "comment", text: "quero o LINK", mediaId: "p1" })).toBe("link");
    expect(matchTrigger(postOnly, { source: "comment", text: "link", mediaId: "p2" })).toBeNull();
    expect(matchTrigger(postOnly, { source: "comment", text: "link", mediaId: "ad", originalMediaId: "p1" })).toBe("link");
    expect(matchTrigger(postOnly, { source: "dm", text: "link" })).toBeNull();
    expect(matchTrigger(postOnly, { source: "comment", text: "linkedin", mediaId: "p1" })).toBeNull();
  });

  it("personalizes known variables and blanks unknown ones", () => {
    expect(personalize("Oi {username}{nada}!", { username: "ana" })).toBe("Oi ana!");
  });
});

describe("flow graph validation", () => {
  it("accepts a complete flow", () => {
    expect(validateGraph(menuFlow)).toEqual([]);
  });

  it("flags an empty starter flow", () => {
    const messages = validateGraph(starterGraph()).map((i) => i.message);
    expect(messages).toContain("Add at least one keyword");
    expect(messages).toContain("Message text is empty");
  });

  it("flags a step nothing leads to", () => {
    const orphan = graph({
      nodes: [...menuFlow.nodes, { id: "lost", type: "message", position: at, data: { text: "?" } }],
      edges: menuFlow.edges,
    });
    expect(validateGraph(orphan)).toEqual([
      { nodeId: "lost", message: "This step is not connected to the flow" },
    ]);
  });

  it("flags bad buttons and duplicate outputs", () => {
    const bad = graph({
      nodes: [
        trigger,
        {
          id: "m",
          type: "message",
          position: at,
          data: { text: "x", buttons: [{ id: "u", kind: "url", title: "Um título bem longo demais", url: "http://x" }] },
        },
        { id: "n", type: "message", position: at, data: { text: "y" } },
      ],
      edges: [
        { id: "1", source: "t", target: "m" },
        { id: "2", source: "t", target: "n" },
      ],
    });
    const messages = validateGraph(bad).map((i) => i.message);
    expect(messages).toContain("Button titles need 1 to 20 characters");
    expect(messages).toContain("Link buttons need an https:// address");
    expect(messages).toContain("Each output can connect to only one step");
  });
});
