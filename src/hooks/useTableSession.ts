"use client";

import { useEffect, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface TableSession {
  sessionId: string;
  guestNumber: number;
  displayLabel: string;
}

export interface JoinResult {
  success: boolean;
  session?: TableSession;
  error?: string;
}

export function useTableSession() {
  const [session, setSession] = useState<TableSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

  // Load session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("hotel-amrut-session");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSession(parsed);
      } catch {
        localStorage.removeItem("hotel-amrut-session");
      }
    }
    setLoading(false);
  }, []);

  const join = useCallback(async (inviteToken: string): Promise<JoinResult> => {
    setLoading(true);
    setError(null);

    try {
      // Sign in anonymously if not already authenticated
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession?.user?.is_anonymous) {
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) {
          throw new Error("Failed to create anonymous session");
        }
      }

      // Call the join_table_session RPC
      const { data, error: rpcError } = await supabase.rpc("join_table_session", {
        p_invite_token: inviteToken,
      });

      if (rpcError) {
        // The RPC returns generic error messages for security
        const message = rpcError.message || "Invalid or expired table invite";
        setError(message);
        return { success: false, error: message };
      }

      if (!data || data.length === 0) {
        const message = "Invalid or expired table invite";
        setError(message);
        return { success: false, error: message };
      }

      const result = data[0];
      const newSession: TableSession = {
        sessionId: result.session_id,
        guestNumber: result.guest_number,
        displayLabel: result.display_label,
      };

      setSession(newSession);
      localStorage.setItem("hotel-amrut-session", JSON.stringify(newSession));
      return { success: true, session: newSession };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join table";
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const clearSession = useCallback(() => {
    setSession(null);
    localStorage.removeItem("hotel-amrut-session");
  }, []);

  return { session, loading, error, join, clearSession };
}