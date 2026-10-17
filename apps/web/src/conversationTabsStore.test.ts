import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { DraftId } from "./composerDraftStore";
import { conversationTabKey, useConversationTabsStore } from "./conversationTabsStore";
import type { ThreadRouteTarget } from "./threadRoutes";

const server = (environment: string, thread: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: scopeThreadRef(environment as EnvironmentId, ThreadId.make(thread)),
});
const first = server("local", "one");
const second = server("local", "two");
const third = server("remote", "one");
const draft = { kind: "draft", draftId: "draft-one" as DraftId } as const;
const state = () => useConversationTabsStore.getState();

beforeEach(() => {
  useConversationTabsStore.setState({ tabs: [] });
  useConversationTabsStore.persist.clearStorage();
});

describe("conversation tabs", () => {
  it("deduplicates visits without changing order and keeps environments separate", () => {
    state().open(first);
    state().open(second);
    state().open(third);
    state().open(first);
    expect(state().tabs.map((tab) => tab.target)).toEqual([first, second, third]);
  });

  it("closes an inactive tab without requesting navigation", () => {
    state().open(first);
    state().open(second);
    expect(state().close(conversationTabKey(first), second)).toBeUndefined();
    expect(state().tabs.map((tab) => tab.target)).toEqual([second]);
  });

  it("closes the active tab onto its right neighbor, then left neighbor, then home", () => {
    [first, second, third].forEach((target) => state().open(target));
    expect(state().close(conversationTabKey(second), second)).toEqual(third);
    expect(state().close(conversationTabKey(third), third)).toEqual(first);
    expect(state().close(conversationTabKey(first), first)).toBeNull();
    expect(state().tabs).toEqual([]);
  });

  it("does not redirect when a stale close action targets a tab that is already gone", () => {
    state().open(second);
    expect(state().close(conversationTabKey(first), first)).toBeUndefined();
    expect(state().tabs.map((tab) => tab.target)).toEqual([second]);
  });

  it("reorders only the requested tab and ignores unknown targets", () => {
    [first, second, third].forEach((target) => state().open(target));
    state().move(conversationTabKey(third), -1);
    expect(state().tabs.map((tab) => tab.target)).toEqual([first, third, second]);
    state().move("missing", -1);
    expect(state().tabs.map((tab) => tab.target)).toEqual([first, third, second]);
  });

  it("replaces a promoted draft in place and merges an already open canonical thread", () => {
    [first, draft, second, third].forEach((target) => state().open(target));
    state().setTitle(conversationTabKey(draft), "Work in progress");
    if (third.kind !== "server") throw new Error("Expected a server fixture");
    state().promote(draft.draftId, third.threadRef);
    expect(state().tabs.map((tab) => tab.target)).toEqual([first, third, second]);
    expect(state().tabs[1]?.title).toBe("Work in progress");
    state().promote(draft.draftId, third.threadRef);
    expect(state().tabs).toHaveLength(3);
  });

  it("persists order and cached titles without requiring any remote snapshot", async () => {
    state().open(third);
    state().open(first);
    state().setTitle(conversationTabKey(third), "Remote conversation");
    const { storage, name } = useConversationTabsStore.persist.getOptions();
    const saved = await storage!.getItem(name!);
    useConversationTabsStore.setState({ tabs: [] });
    await storage!.setItem(name!, saved!);
    await useConversationTabsStore.persist.rehydrate();
    expect(state().tabs).toEqual([
      { target: third, title: "Remote conversation" },
      { target: first, title: "" },
    ]);
    state().open(third);
    expect(state().tabs).toHaveLength(2);
  });

  it.each([null, {}, { tabs: "bad" }, { tabs: null }, { tabs: {} }])(
    "safely hydrates malformed current-version persistence %j",
    async (saved) => {
      const { storage, name } = useConversationTabsStore.persist.getOptions();
      await storage!.setItem(name!, { state: saved as { tabs: [] }, version: 1 });
      await useConversationTabsStore.persist.rehydrate();
      expect(state().tabs).toEqual([]);
      state().open(first);
      expect(state().tabs).toHaveLength(1);
    },
  );

  it("validates and deduplicates saved routes without trusting saved actions", async () => {
    const { storage, name } = useConversationTabsStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: {
        tabs: [
          { target: third, title: "Remote" },
          { target: third, title: "Duplicate" },
          { target: { kind: "server", threadRef: { environmentId: "", threadId: "bad" } } },
          { target: { kind: "draft", draftId: 2 } },
          { target: { kind: "other" } },
          { target: draft, title: null },
        ],
        open: "untrusted",
      } as unknown as { tabs: [] },
      version: 1,
    });
    await useConversationTabsStore.persist.rehydrate();
    expect(state().tabs).toEqual([
      { target: third, title: "Remote" },
      { target: draft, title: "" },
    ]);
    state().open(first);
    expect(state().tabs).toHaveLength(3);
  });
});
