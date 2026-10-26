
"use client";

import { useEffect, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getJoinErrorMessage,
  getJoinRpcCompatibilityAction,
  isValidInviteToken,
} from "@/lib/guest-invite.mjs";

export interface TableSession {
  sessionId: string;
  guestNumber: number;
  displayLabel: string;
  tableLabel: string;
  guestCount: number;
}

export interface JoinResult {
  success: boolean;
  session?: TableSession;
  error?: string;
}

const STORAGE_KEY = "hotel-amrut-session";

export function useTableSession() {
  const [session, setSession] = useState<TableSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createSupabaseBrowserClient();

  const validateSession = useCallback(
    async (sessionId: string, userId: string) => {
      const { data: tableSession, error: sessionError } = await supabase
        .from("table_sessions")
        .select("id, dining_table_id, status")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) {
        throw new Error(
          "Could not verify the table session. Check your connection and retry.",
        );
      }

      if (!tableSession || tableSession.status !== "open") {
        throw new Error("This table session is closed or no longer available.");
      }

      const { data: membership, error: memberError } = await supabase
        .from("table_members")
        .select("id, guest_number, display_label")
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

      if (memberError) {
        throw new Error(
          "Could not verify your table membership. Check your connection and retry.",
        );
      }

      if (!membership) {
        throw new Error("Your guest membership for this table is no longer valid.");
      }

      const { data: diningTable, error: tableError } = await supabase
        .from("dining_tables")
        .select("label, is_active")
        .eq("id", tableSession.dining_table_id)
        .maybeSingle();

      if (tableError) {
        throw new Error(
          "Could not verify table availability. Check your connection and retry.",
        );
      }

      if (!diningTable?.is_active) {
        throw new Error("This table is not accepting orders.");
      }

      const { count, error: countError } = await supabase
        .from("table_members")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);

      if (countError) {
        throw new Error(
          "Could not load the guest list. Check your connection and retry.",
        );
      }

      return {
        sessionId: tableSession.id,
        guestNumber: membership.guest_number,
        displayLabel: membership.display_label,
        tableLabel: diningTable.label,
        guestCount: count ?? 1,
      } satisfies TableSession;
    },
    [supabase],
  );

  const restoreSession = useCallback(async () => {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setSession(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parsed: unknown = JSON.parse(stored);
      const sessionId =
        typeof parsed === "object" && parsed !== null && "sessionId" in parsed
          ? (parsed as { sessionId?: unknown }).sessionId
          : null;

      if (typeof sessionId !== "string" || !sessionId) {
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
        return;
      }

      const { data, error: authError } = await supabase.auth.getSession();

      if (authError) {
        throw new Error(
          "Could not restore your guest sign-in. Check your connection and retry.",
        );
      }

      const user = data.session?.user;

      if (!user?.id || !user.is_anonymous) {
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
        return;
      }

      setSession(await validateSession(sessionId, user.id));
    } catch (err) {
      setSession(null);
      setError(
        err instanceof Error
          ? err.message
          : "Could not verify this table session.",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase, validateSession]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSession();

    const onFocus = () => void restoreSession();
    window.addEventListener("focus", onFocus);

    return () => window.removeEventListener("focus", onFocus);
  }, [restoreSession]);

  const join = useCallback(
    async (inviteToken: string, displayName?: string): Promise<JoinResult> => {
      setLoading(true);
      setError(null);

      try {
        // Check the token's shape without ever logging the token itself.
        if (!isValidInviteToken(inviteToken)) {
          throw new Error(
            "The invite link contains an invalid token. Please copy the newest invite link and try again.",
          );
        }

        const { data: authData, error: authError } =
          await supabase.auth.getSession();

        if (authError) {
          console.error("Guest auth session check failed:", authError.message);
          throw new Error("Could not restore guest sign-in. Please retry.");
        }

        let user = authData.session?.user;

        if (user && !user.is_anonymous) {
          throw new Error(
            "Sign out of the staff account before joining as a guest.",
          );
        }

        if (!user) {
          const { data, error: signInError } =
            await supabase.auth.signInAnonymously();

          if (signInError || !data.user) {
            console.error(
              "Anonymous sign-in failed:",
              signInError?.message ?? "No user returned",
            );
            throw new Error(
              "Could not start a guest session. Check local Supabase Auth settings and retry.",
            );
          }

          user = data.user;
        }

        // Try with displayName first. Older databases expose only the one-argument RPC.
        const rpcResult = await supabase.rpc("join_table_session", {
          p_invite_token: inviteToken,
          p_display_name: displayName?.trim() || null,
        });

        let { data, error: rpcError } = rpcResult;

        const supabaseError = rpcError && typeof rpcError === "object" && "code" in rpcError
          ? rpcError as { code: string; message?: string; details?: string; hint?: string }
          : null;

        const compatibilityAction = getJoinRpcCompatibilityAction(
          supabaseError?.code,
          displayName,
        );

        if (compatibilityAction === "name-unsupported") {
          throw new Error(getJoinErrorMessage("PGRST202"));
        }

        if (compatibilityAction === "legacy") {
          const fallbackResult = await supabase.rpc("join_table_session", {
            p_invite_token: inviteToken,
          });
          ({ data, error: rpcError } = fallbackResult);
        }

        if (rpcError) {
          // Log only diagnostic fields, never the invite token or auth credentials.
          const errObj = rpcError as { code?: string; message?: string; details?: string; hint?: string };
          console.error("join_table_session RPC failed:", {
            code: errObj.code,
            message: errObj.message,
            details: errObj.details,
            hint: errObj.hint,
          });

          throw new Error(getJoinErrorMessage(errObj.code ?? null));
        }

        const result = Array.isArray(data) ? data[0] : null;

        if (!result?.session_id) {
          console.error("join_table_session returned no session identifier.");
          throw new Error(
            "The database did not return a table session. Please try a new invite.",
          );
        }

        // Persist only the session identifier. Every restore rechecks Auth,
        // membership, and status.
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ sessionId: result.session_id }),
        );

        // Persist guest display name separately if provided
        if (displayName?.trim()) {
          try {
            localStorage.setItem(
              "hotel-amrut-guest-name",
              displayName.trim().slice(0, 32),
            );
          } catch {
            // A blocked localStorage must not turn a successful join into a failure.
          }
        }

        const joinedSession = await validateSession(
          result.session_id,
          user.id,
        );

        setSession(joinedSession);

        return { success: true, session: joinedSession };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to join table.";

        setError(message);

        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [supabase, validateSession],
  );

  const clearSession = useCallback(() => {
    setSession(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    session,
    loading,
    error,
    join,
    clearSession,
    refreshSession: restoreSession,
  };
}
