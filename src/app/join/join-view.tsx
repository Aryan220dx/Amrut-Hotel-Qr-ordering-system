"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTableSession } from "@/hooks/useTableSession";
import { Icon } from "@/app/page";

function JoinViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session, loading, join } = useTableSession();
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const inviteToken = searchParams.get("token");

  const attemptJoin = useCallback(async (token: string) => {
    setJoinLoading(true);
    setJoinError(null);
    const result = await join(token);
    if (!result.success) {
      setJoinError(result.error ?? "Invalid or expired table invite");
    }
    setJoinLoading(false);
  }, [join]);

  useEffect(() => {
    if (session) {
      router.push("/");
    }
  }, [session, router]);

  useEffect(() => {
    if (inviteToken && !session && !loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      attemptJoin(inviteToken);
    }
  }, [inviteToken, session, loading, attemptJoin]);

  const handleRetry = () => {
    if (inviteToken) {
      attemptJoin(inviteToken);
    }
  };

  const handleClearToken = () => {
    router.push("/join");
  };

  if (loading) {
    return (
      <main className="app-shell">
        <div className="join-loading">
          <div className="join-spinner" aria-busy="true" aria-label="Loading…" />
          <p>Preparing your table…</p>
        </div>
      </main>
    );
  }

  if (joinLoading) {
    return (
      <main className="app-shell">
        <div className="join-loading">
          <div className="join-spinner" aria-busy="true" aria-label="Joining table…" />
          <p>Joining your table…</p>
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
          <p>{joinError || "Invalid or expired table invite"}</p>
          <p className="join-hint">This invite may have expired, been revoked, or the table session may be closed.</p>
          <div className="join-actions">
            <button className="primary-button" onClick={handleRetry}>
              <Icon name="arrow" /> Try again
            </button>
            <button className="outline-button" onClick={handleClearToken}>
              Start over
            </button>
          </div>
        </div>
      </main>
    );
  }

  // No token provided - show join landing page
  return (
    <main className="app-shell">
      <div className="join-landing">
        <div className="join-icon">✳</div>
        <h1>Join your table</h1>
        <p>Scan the QR code on your table or enter the invite link you received.</p>
        <div className="join-input-group">
          <label htmlFor="invite-token" className="visually-hidden">Invite token</label>
          <input
            id="invite-token"
            type="text"
            placeholder="Paste invite link or token"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const value = e.currentTarget.value.trim();
                if (value) {
                  const token = value.includes("/join?token=")
                    ? new URL(value, window.location.origin).searchParams.get("token")
                    : value;
                  if (token) {
                    router.push(`/join?token=${encodeURIComponent(token)}`);
                  }
                }
              }
            }}
            autoFocus
          />
          <button className="primary-button" onClick={() => {
            const input = document.getElementById("invite-token") as HTMLInputElement;
            if (input?.value.trim()) {
              const value = input.value.trim();
              const token = value.includes("/join?token=")
                ? new URL(value, window.location.origin).searchParams.get("token")
                : value;
              if (token) {
                router.push(`/join?token=${encodeURIComponent(token)}`);
              }
            }
          }}>
            <Icon name="arrow" /> Join
          </button>
        </div>
        <p className="join-demo-note">
          Demo: use a token from <code>npm run db:test:join</code> output or staff invite issuance.
        </p>
      </div>
    </main>
  );
}

export default JoinViewInner;
