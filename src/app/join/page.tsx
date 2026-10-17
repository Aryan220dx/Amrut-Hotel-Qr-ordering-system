"use client";

import { Suspense } from "react";
import JoinViewInner from "./join-view";

export default function JoinPage() {
  return (
    <Suspense fallback={
      <main className="app-shell">
        <div className="join-loading">
          <div className="join-spinner" aria-busy="true" aria-label="Loading…" />
          <p>Preparing your table…</p>
        </div>
      </main>
    }>
      <JoinViewInner />
    </Suspense>
  );
}
