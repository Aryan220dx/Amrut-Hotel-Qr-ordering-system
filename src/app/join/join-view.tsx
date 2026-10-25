"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTableSession } from "@/hooks/useTableSession";
import { Icon } from "@/app/page";
import { cleanInviteUrl, extractInviteToken } from "@/lib/guest-invite.mjs";

function JoinViewInner() {
  const router = useRouter();
  const { session, loading, error: sessionError, join } = useTableSession();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinLock = useRef(false);
  const autoAttemptedToken = useRef<string | null>(null);

  useEffect(() => {
    const currentUrl = window.location.href;
    const token = extractInviteToken(currentUrl, window.location.origin);
    if (!token) return;

    // Remove both legacy query tokens and fragment tokens from browser history before Auth/RPC work.
    window.history.replaceState(window.history.state, "", cleanInviteUrl(currentUrl));
    const timeout = window.setTimeout(() => setInviteToken(token), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const attemptJoin = useCallback(async (token: string) => {
    if (joinLock.current) return;
    joinLock.current = true;
    setJoinLoading(true);
    setJoinError(null);
    try {
      const result = await join(token);
      if (!result.success) setJoinError(result.error ?? "Invalid or expired table invite.");
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join this table. Please retry.");
    } finally {
      joinLock.current = false;
      setJoinLoading(false);
    }
  }, [join]);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  useEffect(() => {
    if (inviteToken && !session && !loading && autoAttemptedToken.current !== inviteToken) {
      autoAttemptedToken.current = inviteToken;
      void attemptJoin(inviteToken);
    }
  }, [inviteToken, session, loading, attemptJoin]);

  const handlePasteJoin = (value: string) => {
    const token = extractInviteToken(value, window.location.origin);
    if (!token) {
      setJoinError("Paste a valid invite token or invite link.");
      return;
    }
    setInviteToken(token);
    void attemptJoin(token);
  };

  if (loading || joinLoading) {
    return (
      <main className="app-shell">
        <div className="join-loading">
          <div className="join-spinner" aria-busy="true" aria-label="Joining table…" />
          <p>{joinLoading ? "Joining your table…" : "Checking your table session…"}</p>
        </div>
      </main>
    );
  }

  if (joinError || (inviteToken && !session)) {
    return (
      <main className="app-shell">
        <div className="join-error">
          <div className="join-error-icon"><Icon name="close" /></div>
          <h1>Couldn&apos;t join table</h1>
          <p>{joinError || "Invalid or expired table invite."}</p>
          <p className="join-hint">This invite may have expired, been revoked, or the table session may be closed.</p>
          <div className="join-actions">
            <button className="primary-button" disabled={!inviteToken} onClick={() => inviteToken && void attemptJoin(inviteToken)}>
              <Icon name="arrow" /> Try again
            </button>
            <button className="outline-button" onClick={() => { setInviteToken(null); setJoinError(null); router.replace("/join"); }}>
              Start over
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="join-landing">
        <div className="join-icon">✳</div>
        <h1>Join your table</h1>
        <p>Scan the QR code on your table or enter the invite link you received.</p>
        {sessionError && <p role="alert" className="inline-note">{sessionError}</p>}
        <div className="join-input-group">
          <label htmlFor="invite-token" className="visually-hidden">Invite token or link</label>
          <input
            id="invite-token"
            type="text"
            placeholder="Paste invite link or token"
            onKeyDown={(event) => {
              if (event.key === "Enter") handlePasteJoin(event.currentTarget.value);
            }}
            autoFocus
          />
          <button className="primary-button" onClick={() => {
            const input = document.getElementById("invite-token") as HTMLInputElement | null;
            if (input) handlePasteJoin(input.value);
          }}>
            <Icon name="arrow" /> Join
          </button>
        </div>
        {joinError && <p role="alert" className="inline-note">{joinError}</p>}
        <p className="join-demo-note">Guest ordering demo. Invite links are validated by the table service.</p>
      </div>
    </main>
  );
}

export default JoinViewInner;
