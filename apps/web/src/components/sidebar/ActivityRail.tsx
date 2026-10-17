import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { usePullRequestsSupported } from "../../state/environments";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { useSidebar, useSidebarVisibility } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";

function ActivityRailButton({
  label,
  active = false,
  pressed,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-synara-activity-button=""
            aria-label={label}
            aria-current={active ? "page" : undefined}
            aria-pressed={pressed}
            data-active={active}
            onClick={onClick}
          >
            {children}
          </button>
        }
      />
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function ActivityRail() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const pullRequestsSupported = usePullRequestsSupported();
  const { toggleSidebar } = useSidebar();
  const sidebarVisible = useSidebarVisibility();

  return (
    <nav data-synara-activity-rail="" aria-label="Workspace">
      <ActivityRailButton
        label="Threads"
        active={!isSidebarUtilityPage(pathname)}
        onClick={() => void navigateToMainApp()}
      >
        <MessageSquareIcon />
      </ActivityRailButton>
      <ActivityRailButton label="Search" onClick={() => openCommandPalette()}>
        <SearchIcon />
      </ActivityRailButton>
      {pullRequestsSupported ? (
        <ActivityRailButton
          label="Pull Requests"
          active={pathname === "/pull-requests"}
          onClick={() =>
            void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() })
          }
        >
          <PullRequestGlyph.pullRequest />
        </ActivityRailButton>
      ) : null}
      <ActivityRailButton
        label="Usage"
        active={pathname === "/usage"}
        onClick={() => void navigate({ to: "/usage" })}
      >
        <ChartNoAxesColumnIcon />
      </ActivityRailButton>
      <div data-synara-activity-rail-spacer="" />
      <ActivityRailButton
        label="Settings"
        active={pathname === "/settings" || pathname.startsWith("/settings/")}
        onClick={() => void navigate({ to: "/settings" })}
      >
        <SettingsIcon />
      </ActivityRailButton>
      <ActivityRailButton
        label="Toggle main sidebar"
        pressed={sidebarVisible}
        onClick={() => void toggleSidebar()}
      >
        {sidebarVisible ? <PanelLeftCloseIcon /> : <PanelLeftIcon />}
      </ActivityRailButton>
    </nav>
  );
}
