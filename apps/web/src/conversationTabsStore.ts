import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DraftId } from "./composerDraftStore";
import { resolveStorage } from "./lib/storage";
import type { ThreadRouteTarget } from "./threadRoutes";

export interface ConversationTab {
  target: ThreadRouteTarget;
  title: string;
}

interface ConversationTabsState {
  tabs: ConversationTab[];
  open: (target: ThreadRouteTarget) => void;
  close: (key: string, active: ThreadRouteTarget | null) => ThreadRouteTarget | null | undefined;
  move: (key: string, direction: -1 | 1) => void;
  promote: (draftId: DraftId, threadRef: ScopedThreadRef) => void;
  setTitle: (key: string, title: string) => void;
}

export function conversationTabKey(target: ThreadRouteTarget): string {
  return target.kind === "server"
    ? JSON.stringify(["server", target.threadRef.environmentId, target.threadRef.threadId])
    : JSON.stringify(["draft", target.draftId]);
}

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 1024;

function readTarget(value: unknown): ThreadRouteTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (target.kind === "draft" && isIdentifier(target.draftId)) {
    return { kind: "draft", draftId: target.draftId as DraftId };
  }
  if (target.kind !== "server" || !target.threadRef || typeof target.threadRef !== "object") {
    return null;
  }
  const ref = target.threadRef as Record<string, unknown>;
  if (!isIdentifier(ref.environmentId) || !isIdentifier(ref.threadId)) return null;
  return {
    kind: "server",
    threadRef: {
      environmentId: ref.environmentId as EnvironmentId,
      threadId: ref.threadId as ThreadId,
    },
  };
}

function readPersistedTabs(value: unknown): ConversationTab[] {
  if (!value || typeof value !== "object" || !("tabs" in value) || !Array.isArray(value.tabs)) {
    return [];
  }
  const tabs: ConversationTab[] = [];
  const seen = new Set<string>();
  for (const candidate of value.tabs.slice(0, 200)) {
    if (!candidate || typeof candidate !== "object") continue;
    const target = readTarget(candidate.target);
    if (!target) continue;
    const key = conversationTabKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push({
      target,
      title: typeof candidate.title === "string" ? candidate.title.slice(0, 512) : "",
    });
  }
  return tabs;
}

export const useConversationTabsStore = create<ConversationTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      open: (target) =>
        set((state) => {
          const key = conversationTabKey(target);
          return state.tabs.some((tab) => conversationTabKey(tab.target) === key)
            ? state
            : { tabs: [...state.tabs, { target, title: "" }] };
        }),
      close: (key, active) => {
        const { tabs } = get();
        const index = tabs.findIndex((tab) => conversationTabKey(tab.target) === key);
        if (index === -1) return undefined;
        const next = tabs.toSpliced(index, 1);
        set({ tabs: next });
        if (!active || conversationTabKey(active) !== key) return undefined;
        return next[index]?.target ?? next[index - 1]?.target ?? null;
      },
      move: (key, direction) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => conversationTabKey(tab.target) === key);
          const destination = index + direction;
          const tab = state.tabs[index];
          if (!tab || destination < 0 || destination >= state.tabs.length) return state;
          return { tabs: state.tabs.toSpliced(index, 1).toSpliced(destination, 0, tab) };
        }),
      promote: (draftId, threadRef) =>
        set((state) => {
          const draftKey = conversationTabKey({ kind: "draft", draftId });
          const draftTab = state.tabs.find((tab) => conversationTabKey(tab.target) === draftKey);
          if (!draftTab) return state;
          const target = { kind: "server", threadRef } as const;
          const key = conversationTabKey(target);
          const serverTab = state.tabs.find((tab) => conversationTabKey(tab.target) === key);
          return {
            tabs: state.tabs.flatMap((tab) => {
              const currentKey = conversationTabKey(tab.target);
              if (currentKey === draftKey)
                return [{ target, title: serverTab?.title || tab.title }];
              return currentKey === key ? [] : [tab];
            }),
          };
        }),
      setTitle: (key, title) =>
        set((state) => {
          const trimmed = title.trim().slice(0, 512);
          if (
            !trimmed ||
            !state.tabs.some(
              (tab) => conversationTabKey(tab.target) === key && tab.title !== trimmed,
            )
          ) {
            return state;
          }
          return {
            tabs: state.tabs.map((tab) =>
              conversationTabKey(tab.target) === key ? { ...tab, title: trimmed } : tab,
            ),
          };
        }),
    }),
    {
      name: "t3code:conversation-tabs:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ tabs }) => ({ tabs }),
      migrate: (value) => ({ tabs: readPersistedTabs(value) }),
      merge: (value, current) => ({ ...current, tabs: readPersistedTabs(value) }),
    },
  ),
);
