import type { ActivityEvent } from "./api";

export interface StoredAgentRun {
  activity: ActivityEvent[];
  summary: string;
  finishedAt: string | null;
}

const STORAGE_KEY = "majubiz_agent_runs";

export function loadAgentRuns(): Record<string, StoredAgentRun> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredAgentRun>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAgentRuns(runs: Record<string, StoredAgentRun>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    /* quota / private mode */
  }
}

export function formatRunTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}
