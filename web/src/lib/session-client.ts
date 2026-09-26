"use client";

import { createContext, useContext } from "react";
import type { DemoUser } from "./users";

/**
 * The signed-in user and which conversation is open. Provided by SessionGate,
 * above <CopilotKit>, because the open thread is a CopilotKit prop.
 */
export interface SessionValue {
  user: DemoUser;
  signOut: () => Promise<void>;
  /** Id of the open conversation. A fresh id is a new, not-yet-saved one. */
  threadId: string;
  openThread: (id: string) => void;
  newThread: () => void;
  /** Bumped whenever the history list may have changed. */
  historyVersion: number;
  refreshHistory: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionGate");
  return ctx;
}
