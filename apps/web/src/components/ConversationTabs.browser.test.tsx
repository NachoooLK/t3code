import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({ hosted: false, connected: true }));

vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ isReady: true, environments: state.connected ? [{}] : [] })) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => projects) as never,
  useThreadShells: () => [],
  useThreadShell: () => null,
  useAllEnvironmentShellsBootstrapped: () => true,
  readProject: (() => projects[0]) as never,
}));
// The normal index action reuses an existing empty draft. Keep navigation real so
// mounting that action after the last tab closes reproduces the reopening bug.
vi.mock(import("../hooks/useHandleNewThread"), async () => {
  const { useNavigate } = await import("@tanstack/react-router");
  return {
    useNewThreadHandler: () => {
      const navigate = useNavigate();
      return async () => {
        await navigate({ to: "/draft/$draftId", params: { draftId }, replace: true });
        return { draftId, threadId };
      };
    },
  };
});

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useConversationTabsStore } from "../conversationTabsStore";
import { ConversationTabs } from "./ConversationTabs";
import { TooltipProvider } from "./ui/tooltip";
import { Route as IndexRoute } from "../routes/_chat.index";

const environmentId = EnvironmentId.make("tab-close-environment");
const projectId = ProjectId.make("tab-close-project");
const draftId = DraftId.make("tab-close-draft");
const threadId = ThreadId.make("tab-close-thread");
const projects = [
  {
    id: projectId,
    environmentId,
    title: "Project",
    workspaceRoot: "/work/project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.hosted = false;
  state.connected = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useConversationTabsStore.setState({ tabs: [] });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  const projectRef = scopeProjectRef(environmentId, projectId);
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId(scopedProjectKey(projectRef), projectRef, draftId, {
      threadId,
    });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useConversationTabsStore.persist.clearStorage();
  useComposerDraftStore.persist.clearStorage();
  vi.unstubAllGlobals();
});

async function mount(initialEntry: string) {
  const rootRoute = createRootRoute({
    beforeLoad: () => ({
      authGateState: { status: state.hosted ? "hosted-static" : "authenticated" },
    }),
    component: () => (
      <TooltipProvider>
        <ConversationTabs />
        <Outlet />
      </TooltipProvider>
    ),
  });
  const chatRoute = createRoute({ getParentRoute: () => rootRoute, id: "_chat" });
  const indexRoute = createRoute({
    getParentRoute: () => chatRoute,
    path: "/",
    component: IndexRoute.options.component!,
    validateSearch: IndexRoute.options.validateSearch,
  });
  const draftRoute = createRoute({
    getParentRoute: () => chatRoute,
    path: "draft/$draftId",
    component: () => <div>Draft editor</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([chatRoute.addChildren([indexRoute, draftRoute])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}

const closeButton = () =>
  container.querySelector<HTMLButtonElement>('[aria-label="Close New thread"]');

describe("closing the last conversation tab", () => {
  it.each(["", "Keep my prompt"])(
    "stays closed and preserves the reopenable draft %j",
    async (prompt) => {
      useComposerDraftStore.getState().setPrompt(draftId, prompt);
      const session = useComposerDraftStore.getState().getDraftSession(draftId);
      const router = await mount(`/draft/${draftId}`);
      await vi.waitFor(() => expect(closeButton()).not.toBeNull());
      await act(async () => userEvent.click(closeButton()!));
      await vi.waitFor(() => expect(container.textContent).toContain("No open conversations"));
      expect(router.state.location.pathname).toBe("/");
      expect(router.state.location.search).toEqual({ closed: true });
      expect(useConversationTabsStore.getState().tabs).toEqual([]);
      expect(useComposerDraftStore.getState().getDraftSession(draftId)).toEqual(session);
      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt ?? "").toBe(prompt);

      await act(async () => router.navigate({ to: "/draft/$draftId", params: { draftId } }));
      await vi.waitFor(() => expect(closeButton()).not.toBeNull());
      expect(useConversationTabsStore.getState().tabs).toHaveLength(1);
      expect(useComposerDraftStore.getState().getDraftSession(draftId)).toEqual(session);
      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt ?? "").toBe(prompt);
    },
  );

  it.each(["/", "/?closed=false", "/?closed=1"])(
    "preserves normal automatic draft landing for %s",
    async (entry) => {
      const router = await mount(entry);
      await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/draft/${draftId}`));
      await vi.waitFor(() => expect(closeButton()).not.toBeNull());
    },
  );

  it("preserves hosted onboarding without a connected environment", async () => {
    state.hosted = true;
    state.connected = false;
    await mount("/?closed=true");
    expect(container.textContent).toContain("Connect to a computer running T3 Code");
    expect(useConversationTabsStore.getState().tabs).toEqual([]);
  });
});
