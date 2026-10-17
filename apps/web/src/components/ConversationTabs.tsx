import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  conversationTabKey,
  type ConversationTab,
  useConversationTabsStore,
} from "../conversationTabsStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { cn } from "../lib/utils";
import { useThreadShell } from "../state/entities";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../threadRoutes";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function ConversationTabItem({
  tab,
  active,
  onClose,
}: {
  tab: ConversationTab;
  active: boolean;
  onClose: () => void;
}) {
  const shell = useThreadShell(tab.target.kind === "server" ? tab.target.threadRef : null);
  const key = conversationTabKey(tab.target);
  const title =
    shell?.title || tab.title || (tab.target.kind === "draft" ? "New thread" : "Conversation");
  const setTitle = useConversationTabsStore((state) => state.setTitle);
  const move = useConversationTabsStore((state) => state.move);
  const elementRef = useRef<HTMLLIElement>(null);
  const needsAttention = shell?.hasPendingApprovals || shell?.hasPendingUserInput;
  const running = threadRuntimeIsActive(shell?.runtime);
  const status = needsAttention ? "Needs your attention" : running ? "Running" : null;
  const provider = shell?.runtime?.providerName;
  const description = [title, provider, status].filter(Boolean).join(" · ");

  useEffect(() => {
    if (shell?.title) setTitle(key, shell.title);
  }, [key, setTitle, shell?.title]);

  useEffect(() => {
    if (active) elementRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (
      event.altKey &&
      event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      move(key, event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    const list = event.currentTarget.parentElement;
    const links = list?.querySelectorAll<HTMLAnchorElement>("a[data-conversation-tab-link]");
    if (!links?.length) return;
    const current = Array.from(links).findIndex((link) => event.currentTarget.contains(link));
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : (current + (event.key === "ArrowLeft" ? -1 : 1) + links.length) % links.length;
    event.preventDefault();
    links[next]?.focus();
  };

  const linkProps =
    tab.target.kind === "server"
      ? { to: "/$environmentId/$threadId" as const, params: tab.target.threadRef }
      : { to: "/draft/$draftId" as const, params: { draftId: tab.target.draftId } };

  return (
    <li
      ref={elementRef}
      data-synara-conversation-tab
      data-active={active || undefined}
      className={cn(
        "group relative flex h-9 shrink-0 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent/50",
        active && "border-border bg-background text-foreground shadow-xs",
      )}
      onKeyDown={onKeyDown}
    >
      {status ? (
        <span
          aria-label={status}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            needsAttention ? "bg-warning" : "bg-primary",
          )}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              {...linkProps}
              data-conversation-tab-link
              aria-current={active ? "page" : undefined}
              className="flex h-full min-w-16 max-w-48 items-center rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
        >
          <span className="truncate">{title}</span>
        </TooltipTrigger>
        <TooltipPopup>{description}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-micro"
              aria-label={`Close ${title}`}
              onClick={onClose}
            />
          }
        >
          <XIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup>Close tab</TooltipPopup>
      </Tooltip>
    </li>
  );
}

export function ConversationTabs() {
  const route = useThreadRouteTarget();
  const environmentId = route?.kind === "server" ? route.threadRef.environmentId : undefined;
  const threadId = route?.kind === "server" ? route.threadRef.threadId : undefined;
  const draftId = route?.kind === "draft" ? route.draftId : undefined;
  const target = resolveThreadRouteTarget({ environmentId, threadId, draftId });
  const promotedTo = useComposerDraftStore((state) =>
    draftId ? state.getDraftSession(draftId)?.promotedTo : null,
  );
  const active: ThreadRouteTarget | null =
    target?.kind === "draft" && promotedTo ? { kind: "server", threadRef: promotedTo } : target;
  const activeEnvironmentId =
    active?.kind === "server" ? active.threadRef.environmentId : undefined;
  const activeThreadId = active?.kind === "server" ? active.threadRef.threadId : undefined;
  const activeDraftId = active?.kind === "draft" ? active.draftId : undefined;
  const activeKey = active ? conversationTabKey(active) : null;
  const tabs = useConversationTabsStore((state) => state.tabs);
  const open = useConversationTabsStore((state) => state.open);
  const navigate = useNavigate();
  const stripRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const syncPromotions = () => {
      const drafts = useComposerDraftStore.getState();
      const store = useConversationTabsStore.getState();
      for (const tab of store.tabs) {
        if (tab.target.kind !== "draft") continue;
        const ref = drafts.getDraftSession(tab.target.draftId)?.promotedTo;
        if (ref) store.promote(tab.target.draftId, ref);
      }
    };
    // Observe synchronously: finalization can remove a draft before React renders again.
    const unsubscribe = useComposerDraftStore.subscribe(syncPromotions);
    syncPromotions();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const current = resolveThreadRouteTarget({
      environmentId: activeEnvironmentId,
      threadId: activeThreadId,
      draftId: activeDraftId,
    });
    if (current) open(current);
  }, [activeDraftId, activeEnvironmentId, activeThreadId, open]);

  const close = (key: string) => {
    const destination = useConversationTabsStore.getState().close(key, active);
    if (destination === undefined) return;
    if (destination === null) void navigate({ to: "/", search: { closed: true } });
    else if (destination.kind === "server")
      void navigate({ to: "/$environmentId/$threadId", params: destination.threadRef });
    else void navigate({ to: "/draft/$draftId", params: { draftId: destination.draftId } });
    requestAnimationFrame(() =>
      stripRef.current?.querySelector<HTMLAnchorElement>("a[aria-current=page]")?.focus(),
    );
  };

  return (
    <nav
      aria-label="Conversation tabs"
      data-synara-conversation-tabs
      className="flex min-w-0 flex-1 items-center gap-1"
    >
      <ol
        ref={stripRef}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain px-1 py-1"
      >
        {tabs.map((tab) => {
          const key = conversationTabKey(tab.target);
          return (
            <ConversationTabItem
              key={key}
              tab={tab}
              active={key === activeKey}
              onClose={() => close(key)}
            />
          );
        })}
      </ol>
      <div className="shrink-0 px-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label="New thread"
                onClick={() => openCommandPalette({ open: "new-thread-in" })}
              />
            }
          >
            <PlusIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup>New thread</TooltipPopup>
        </Tooltip>
      </div>
    </nav>
  );
}
