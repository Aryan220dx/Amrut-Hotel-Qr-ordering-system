"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildInviteLink, getInviteRow, getOpenedSessionId, parseDemoTableIds } from "@/lib/staff-demo.mjs";
import { formatOrderTotal, groupOrderItems, nextOrderStatus } from "@/lib/staff-orders.mjs";
import InviteQr from "./invite-qr";
import styles from "./staff.module.css";

type StaffAssignment = { role: "staff" | "manager" | "owner"; is_active: boolean };
type DemoTable = { id: string; label: string; is_active: boolean };
type AuthUser = Pick<User, "id" | "email" | "is_anonymous">;
type StaffOrderStatus = "placed" | "preparing" | "ready" | "served" | "cancelled";
type StaffOrderItem = { id: string; order_id: string; quantity: number; name_snapshot: string; line_total_paise: number | string };
type StaffOrder = {
  id: string;
  status: StaffOrderStatus;
  total_paise: number | string;
  placed_at: string;
  guest_note: string | null;
  items: StaffOrderItem[];
};

export default function StaffPage() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [staffCheck, setStaffCheck] = useState<{
    userId: string;
    assignment: StaffAssignment | null;
    message: string | null;
  } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [selectedDemoTableId, setSelectedDemoTableId] = useState(() =>
    parseDemoTableIds(process.env.NEXT_PUBLIC_DEMO_TABLE_IDS)[0] ?? "",
  );
  const [tableCheck, setTableCheck] = useState<{
    key: string;
    table: DemoTable | null;
    sessionId: string | null;
    error: string | null;
  } | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteExpiry, setInviteExpiry] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [loadedOrders, setLoadedOrders] = useState<StaffOrder[]>([]);
  const [ordersSessionId, setOrdersSessionId] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [boardBusyOrderId, setBoardBusyOrderId] = useState<string | null>(null);
  const orderRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      try {
        const client = createSupabaseBrowserClient();
        if (active) setSupabase(client);
      } catch {
        if (active) {
          setSetupError("Supabase is not configured. Set the local public URL and publishable key, then restart the app.");
          setAuthLoading(false);
        }
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const user = session?.user;
      setAuthUser(user ? { id: user.id, email: user.email, is_anonymous: user.is_anonymous } : null);
      setAuthLoading(false);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setSignInError("Could not restore the local Auth session. Reload and try again.");
      }
      const user = data.session?.user;
      setAuthUser(user ? { id: user.id, email: user.email, is_anonymous: user.is_anonymous } : null);
      setAuthLoading(false);
    }).catch(() => {
      if (active) {
        setSignInError("Could not restore the local Auth session. Reload and try again.");
        setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !authUser || authUser.is_anonymous) return;
    let active = true;

    void Promise.resolve(supabase.from("staff_members")
      .select("role,is_active")
      .eq("user_id", authUser.id)
      .maybeSingle()
    ).then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setStaffCheck({ userId: authUser.id, assignment: null, message: "Could not check your staff assignment. The database RPCs will still enforce authorization." });
        } else if (!data?.is_active || !["staff", "manager", "owner"].includes(data.role)) {
          setStaffCheck({ userId: authUser.id, assignment: null, message: "This account has no active staff assignment. Ask the project owner to authorize it through the trusted local database administration process." });
        } else {
          setStaffCheck({ userId: authUser.id, assignment: data as StaffAssignment, message: null });
        }
      })
      .catch(() => {
        if (active) {
          setStaffCheck({ userId: authUser.id, assignment: null, message: "Could not check your staff assignment. The database RPCs will still enforce authorization." });
        }
      });

    return () => { active = false; };
  }, [authUser, supabase]);

  const staffAssignment = authUser && staffCheck?.userId === authUser.id ? staffCheck.assignment : null;
  const authorizationMessage = authUser?.is_anonymous
    ? "A guest session is active in this browser. Signing out ends that guest identity and may prevent this browser from restoring its table membership. Use a separate browser profile for staff."
    : authUser && staffCheck?.userId === authUser.id ? staffCheck.message : null;
  const staffLoading = Boolean(authUser && !authUser.is_anonymous && staffCheck?.userId !== authUser.id);
  const isAuthorized = Boolean(staffAssignment?.is_active && !authUser?.is_anonymous);

  useEffect(() => {
    if (!supabase || !authUser || !staffAssignment?.is_active) return;

    let active = true;
    const demoTableId = selectedDemoTableId;
    const key = `${authUser.id}:${demoTableId || "missing"}`;

    if (!demoTableId) {
      return () => { active = false; };
    }

    void (async () => {
      const { data: demoTable, error: demoTableError } = await supabase
        .from("dining_tables")
        .select("id,label,is_active")
        .eq("id", demoTableId)
        .eq("is_active", true)
        .maybeSingle();
      if (demoTableError) throw new Error("Could not load the designated demo table. Confirm this account has an active staff assignment.");
      if (!demoTable) throw new Error("The configured demo table is unavailable or inactive.");

      const { data: openSession, error: sessionError } = await supabase
        .from("table_sessions")
        .select("id")
        .eq("dining_table_id", demoTableId)
        .eq("status", "open")
        .maybeSingle();
      if (sessionError) throw new Error("Could not check the demo table session. Retry before opening a session.");

      if (active) {
        setTableCheck({ key, table: demoTable as DemoTable, sessionId: openSession?.id ?? null, error: null });
      }
    })().catch((error: unknown) => {
      if (active) setTableCheck({ key, table: null, sessionId: null, error: error instanceof Error ? error.message : "Could not load the demo table." });
    });

    return () => { active = false; };
  }, [authUser, selectedDemoTableId, staffAssignment, supabase]);

  const demoTableIds = parseDemoTableIds(process.env.NEXT_PUBLIC_DEMO_TABLE_IDS);
  const tableKey = `${authUser?.id ?? "none"}:${selectedDemoTableId || "missing"}`;
  const currentTableCheck = tableCheck?.key === tableKey ? tableCheck : null;
  const table = currentTableCheck?.table ?? null;
  const sessionId = currentTableCheck?.sessionId ?? null;
  const tableError = currentTableCheck?.error ?? (isAuthorized && !selectedDemoTableId
    ? "Choose a local demo table by setting NEXT_PUBLIC_DEMO_TABLE_IDS to one or more owner-designated dining_tables UUIDs. This UI will not list other tables."
    : null);
  const tableLoading = Boolean(isAuthorized && selectedDemoTableId && !currentTableCheck);
  const orders = ordersSessionId === sessionId && isAuthorized ? loadedOrders : [];

  const refreshOrderBoard = useCallback(async () => {
    if (!supabase || !sessionId || !isAuthorized) return;
    const requestId = ++orderRequestId.current;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const { data: orderRows, error: orderError } = await supabase
        .from("orders")
        .select("id,status,total_paise,placed_at,guest_note")
        .eq("session_id", sessionId)
        .order("placed_at", { ascending: false })
        .limit(50);
      if (orderError) throw orderError;

      const rows = (orderRows ?? []) as Omit<StaffOrder, "items">[];
      const orderIds = rows.map((order) => order.id);
      let itemsByOrder = new Map<string, StaffOrderItem[]>();
      if (orderIds.length) {
        const { data: itemRows, error: itemError } = await supabase
          .from("order_items")
          .select("id,order_id,quantity,name_snapshot,line_total_paise")
          .in("order_id", orderIds);
        if (itemError) throw itemError;
        itemsByOrder = groupOrderItems((itemRows ?? []) as StaffOrderItem[]);
      }
      if (requestId === orderRequestId.current) {
        setLoadedOrders(rows.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] })));
        setOrdersSessionId(sessionId);
      }
    } catch {
      if (requestId === orderRequestId.current) setOrdersError("Could not load orders for this table session. Retry in a moment.");
    } finally {
      if (requestId === orderRequestId.current) setOrdersLoading(false);
    }
  }, [isAuthorized, sessionId, supabase]);

  useEffect(() => {
    if (!isAuthorized || !sessionId) return;
    let active = true;
    queueMicrotask(() => { if (active) void refreshOrderBoard(); });
    const timer = window.setInterval(() => void refreshOrderBoard(), 5000);
    return () => {
      active = false;
      orderRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [isAuthorized, refreshOrderBoard, sessionId]);

  const advanceOrder = async (order: StaffOrder) => {
    if (!supabase) return;
    const nextStatus = nextOrderStatus(order.status);
    if (!nextStatus) return;
    setBoardBusyOrderId(order.id);
    setOrdersError(null);
    try {
      const { error } = await supabase.rpc("update_order_status", {
        p_order_id: order.id,
        p_new_status: nextStatus,
      });
      if (error) throw error;
      await refreshOrderBoard();
    } catch {
      setOrdersError("The order status was not changed. Refresh the board and try again.");
    } finally {
      setBoardBusyOrderId(null);
    }
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setSignInError(null);
    setPassword("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch {
      setSignInError("Sign-in failed. Check the local staff account and try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setInviteLink(null);
    setInviteExpiry(null);
    setCopyState("idle");
    setOperationError(null);
    setTableCheck(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) setSignInError("Could not sign out. Please retry.");
    } finally {
      setAuthBusy(false);
    }
  };

  const openSession = async () => {
    if (!supabase || !table || !staffAssignment?.is_active || sessionId) return;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const { data, error } = await supabase.rpc("open_table_session", {
        p_dining_table_id: table.id,
      });
      if (error) throw error;
      setTableCheck((previous) => previous?.key === tableKey
        ? { ...previous, sessionId: getOpenedSessionId(data) }
        : previous);
    } catch {
      setTableCheck(null);
      setOperationError("The database did not open a session. The account may not be authorized, the table may be inactive, or another staff member may have opened it.");
    } finally {
      setOperationBusy(false);
    }
  };

  const issueInvite = async () => {
    if (!supabase || !sessionId || !staffAssignment?.is_active) return;
    setOperationBusy(true);
    setOperationError(null);
    setCopyState("idle");
    try {
      const { data, error } = await supabase.rpc("issue_table_invite", {
        p_session_id: sessionId,
        p_expires_in_seconds: 3600,
      });
      if (error) throw error;
      const invite = getInviteRow(data);
      setInviteLink(buildInviteLink(
        window.location.origin,
        invite.invite_token,
        process.env.NEXT_PUBLIC_LAN_ORIGIN,
      ));
      setInviteExpiry(invite.expires_at);
    } catch {
      setInviteLink(null);
      setInviteExpiry(null);
      setCopyState("idle");
      setOperationError("The database did not issue the invite. Confirm staff authorization and that the table session is still open.");
    } finally {
      setOperationBusy(false);
    }
  };

  const copyInvite = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }, [inviteLink]);

  const signedIn = Boolean(authUser);
  return (
    <main className="app-shell">
      <section className={styles.panel}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>HOTEL AMRUT · LOCAL STAFF TOOLS</span>
          <h1>Demo table access</h1>
          <p>Sign in with an existing authorized staff account to prepare a local guest invite.</p>
        </header>

        {setupError && <p className={styles.error} role="alert">{setupError}</p>}

        {authLoading ? (
          <div className={styles.status} role="status" aria-live="polite">Checking local sign-in…</div>
        ) : !signedIn ? (
          <form className={styles.form} onSubmit={handleSignIn}>
            <label htmlFor="staff-email">Email</label>
            <input id="staff-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="staff-password">Password</label>
            <input id="staff-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            {signInError && <p className={styles.error} role="alert">{signInError}</p>}
            <button className="primary-button" disabled={authBusy || !supabase || Boolean(setupError)} type="submit">
              {authBusy ? "Signing in…" : "Sign in"}
            </button>
            <p className={styles.note}>This page has no signup or password-creation flow. Staff roles are assigned only through trusted database administration.</p>
          </form>
        ) : (
          <div className={styles.content}>
            <div className={styles.account}>
              <div>
                <span className={styles.eyebrow}>SIGNED IN</span>
                <strong>{authUser?.email ?? "Local Auth account"}</strong>
              </div>
              <button className="outline-button" disabled={authBusy} onClick={() => void handleSignOut()} type="button">Sign out</button>
            </div>

            {staffLoading ? (
              <div className={styles.status} role="status" aria-live="polite">Checking staff assignment…</div>
            ) : authorizationMessage ? (
              <p className={styles.error} role="alert">{authorizationMessage}</p>
            ) : isAuthorized ? (
              <>
                <p className={styles.authorized} role="status">Authorized staff account · {staffAssignment?.role}</p>
                <p className={styles.note}>This assignment check is for UI feedback. The database independently checks staff authorization on every management RPC.</p>

                {demoTableIds.length > 0 && (
                  <label className={styles.tableSelect} htmlFor="demo-table-select">
                    Designated demo table
                    <select
                      id="demo-table-select"
                      value={selectedDemoTableId}
                      onChange={(event) => {
                        setSelectedDemoTableId(event.target.value);
                        setInviteLink(null);
                        setInviteExpiry(null);
                        setOperationError(null);
                      }}
                    >
                      {demoTableIds.map((id, index) => (
                        <option key={id} value={id}>Demo table {index + 1} · {id.slice(0, 8)}</option>
                      ))}
                    </select>
                  </label>
                )}

                {tableLoading ? (
                  <div className={styles.status} role="status" aria-live="polite">Loading designated demo table…</div>
                ) : tableError ? (
                  <p className={styles.error} role="alert">{tableError}</p>
                ) : table ? (
                  <section className={styles.tableCard} aria-label="Designated demo table">
                    <span className={styles.eyebrow}>DESIGNATED LOCAL TABLE</span>
                    <h2>{table.label}</h2>
                    {sessionId ? (
                      <p className={styles.authorized}>An open session is available for this designated table.</p>
                    ) : (
                      <>
                        <p>Open a new session before issuing a guest invite.</p>
                        <button className="primary-button" disabled={operationBusy} onClick={() => void openSession()} type="button">
                          {operationBusy ? "Opening session…" : "Open table session"}
                        </button>
                      </>
                    )}
                    {sessionId && (
                      <div className={styles.inviteActions}>
                        <button className="primary-button" disabled={operationBusy} onClick={() => void issueInvite()} type="button">
                          {operationBusy ? "Issuing invite…" : inviteLink ? "Issue replacement invite" : "Issue guest invite"}
                        </button>
                        <p className={styles.note}>Issuing a replacement revokes the previous invite. The token is returned once and is not saved by this page.</p>
                      </div>
                    )}
                    {operationError && <p className={styles.error} role="alert">{operationError}</p>}
                    {inviteLink && (
                      <div className={styles.inviteResult}>
                        <label htmlFor="guest-invite-link">Guest invite link · expires {inviteExpiry ? new Date(inviteExpiry).toLocaleString() : "soon"}</label>
                        <input id="guest-invite-link" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
                        <button className="outline-button" onClick={() => void copyInvite()} type="button">
                          {copyState === "copied" ? "Copied" : "Copy invite link"}
                        </button>
                        {copyState === "error" && <p className={styles.error} role="alert">Clipboard access failed. Select and copy the link above.</p>}
                        <InviteQr key={inviteLink} inviteLink={inviteLink} />
                        <p className={styles.note}>Keep this page open until the link is copied. Refreshing or signing out clears the token.</p>
                      </div>
                    )}
                    {sessionId && (
                      <section className={styles.orderBoard} aria-label="Orders for this table session">
                        <div className={styles.boardHeading}>
                          <div>
                            <span className={styles.eyebrow}>LIVE SERVICE BOARD</span>
                            <h3>Table orders</h3>
                          </div>
                          <button className="outline-button" type="button" onClick={() => void refreshOrderBoard()} disabled={ordersLoading}>
                            {ordersLoading ? "Refreshing…" : "Refresh"}
                          </button>
                        </div>
                        <p className={styles.note}>This board refreshes every five seconds and shows orders from this open table session.</p>
                        {ordersError && <p className={styles.error} role="alert">{ordersError}</p>}
                        {ordersLoading && orders.length === 0 ? (
                          <div className={styles.status} role="status" aria-live="polite">Loading table orders…</div>
                        ) : orders.length === 0 && !ordersError ? (
                          <div className={styles.status} role="status">No orders yet. New guest orders will appear here.</div>
                        ) : (
                          <div className={styles.orderList}>
                            {orders.map((order) => {
                              const nextStatus = nextOrderStatus(order.status);
                              return (
                                <article className={styles.orderCard} key={order.id}>
                                  <div className={styles.orderTopline}>
                                    <div>
                                      <span className={styles.eyebrow}>ORDER {order.id.slice(0, 8).toUpperCase()}</span>
                                      <p>{new Date(order.placed_at).toLocaleString()}</p>
                                    </div>
                                    <span className={styles.orderStatus}>{order.status}</span>
                                  </div>
                                  <ul className={styles.orderItems}>
                                    {order.items.map((item) => (
                                      <li key={item.id}><span>{item.quantity} × {item.name_snapshot}</span><b>{formatOrderTotal(item.line_total_paise)}</b></li>
                                    ))}
                                  </ul>
                                  {order.guest_note && <p className={styles.guestNote}><b>Guest note</b><br />{order.guest_note}</p>}
                                  <div className={styles.orderFooter}>
                                    <span>Total · payment not collected</span><b>{formatOrderTotal(order.total_paise)}</b>
                                  </div>
                                  {nextStatus && (
                                    <button className="primary-button" type="button" disabled={boardBusyOrderId !== null} onClick={() => void advanceOrder(order)}>
                                      {boardBusyOrderId === order.id ? "Updating…" : `Mark ${nextStatus}`}
                                    </button>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    )}
                  </section>
                ) : null}
              </>
            ) : null}
            {signInError && <p className={styles.error} role="alert">{signInError}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
