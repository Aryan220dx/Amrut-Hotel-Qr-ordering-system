"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatINR } from "@/data/menu";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createPendingSubmission,
  createSingleFlight,
  getOrderIdFromSearch,
  getOrderProgress,
  getRpcRow,
  orderTrackingPath,
  parsePendingSubmission,
} from "@/lib/order-helpers.mjs";
import { useCart, type CartItem } from "@/hooks/useCart";
import { useTableSession } from "@/hooks/useTableSession";
import cartStyles from "./cart.module.css";

type View = "menu" | "checkout" | "tracking" | "history";
type PaymentMode = "one" | "equal" | "items";

export function Icon({ name }: { name: "bag" | "arrow" | "close" | "clock" | "star" | "plus" | "minus" | "check" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    bag: <><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3Z"/>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    minus: <path d="M5 12h14"/>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

interface MenuOption {
  id: string;
  option_key: string;
  label: string;
  price_delta_paise: number;
  is_available: boolean;
  sort_order: number;
}

interface MenuOptionGroup {
  id: string;
  menu_item_id: string;
  option_key: string;
  label: string;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  menu_options: MenuOption[];
}

interface MenuItem {
  id: string;
  item_code: string;
  name: string;
  description: string;
  base_price_paise: number;
  category: string;
  tag: string | null;
  image_url: string;
  optionGroups: MenuOptionGroup[];
}

interface OrderStatusRow {
  order_id: string;
  status: "placed" | "preparing" | "ready" | "served" | "cancelled";
  subtotal_paise: number;
  total_paise: number;
  placed_at: string;
  placed_by_member_label: string;
  guest_note: string | null;
  order_items: Array<{ id: string; name: string; quantity: number; line_total_paise: number }>;
  allocations: Array<{ member_id: string; display_label: string; amount_paise: number; allocation_method: PaymentMode }>;
}

const ORDER_STEPS = ["Order placed", "Preparing", "Ready", "Served"];

export default function Home() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState("Popular");
  const [view, setView] = useState<View>("menu");
  const [optionSelections, setOptionSelections] = useState<Record<string, Record<string, string | string[]>>>({});
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("one");
  const [guestNote, setGuestNote] = useState("");
  const [cartTab, setCartTab] = useState<"shared" | "mine">("shared");
  const [showCart, setShowCart] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderStatusRow | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; status: string; subtotal_paise: number; placed_at: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const { session, loading: sessionLoading, error: sessionError, refreshSession } = useTableSession();
  const {
    items: cartItems,
    loading: cartLoading,
    error: cartError,
    addToCart,
    updateCartItemQuantity,
    removeCartItem,
    getCartTotal,
    refreshCart,
  } = useCart();
  const supabase = createSupabaseBrowserClient();
  const orderRequestInFlight = useRef(false);
  const restoredOrderState = useRef(false);
  const cartDialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    const loadMenu = async () => {
      setMenuLoading(true);
      setMenuError(null);
      try {
        const { data, error } = await supabase.from("v_menu_items").select("*").order("category").order("name");
        if (error) throw error;
        const rows = data ?? [];
        const ids = rows.map((item) => item.id as string);
        const groupsResult = ids.length
          ? await supabase.from("menu_option_groups")
            .select("id,menu_item_id,option_key,label,min_selections,max_selections,sort_order,menu_options(id,option_key,label,price_delta_paise,is_available,sort_order)")
            .in("menu_item_id", ids)
            .order("sort_order")
          : { data: [], error: null };
        if (groupsResult.error) throw groupsResult.error;
        const groupsByItem = new Map<string, MenuOptionGroup[]>();
        for (const rawGroup of groupsResult.data ?? []) {
          const group = rawGroup as unknown as MenuOptionGroup;
          group.menu_options = (group.menu_options ?? []).filter((option) => option.is_available)
            .sort((a, b) => a.sort_order - b.sort_order);
          groupsByItem.set(group.menu_item_id, [...(groupsByItem.get(group.menu_item_id) ?? []), group]);
        }
        if (!active) return;
        setMenuItems(rows.map((row) => ({
          ...(row as Omit<MenuItem, "optionGroups">),
          optionGroups: groupsByItem.get(row.id as string) ?? [],
        })));
      } catch {
        if (active) {
          setMenuItems([]);
          setMenuError("The menu could not be loaded. Check your connection and try again.");
        }
      } finally {
        if (active) setMenuLoading(false);
      }
    };
    void loadMenu();
    return () => { active = false; };
  }, [supabase]);

  const menuCategories = useMemo(() => {
    const categories = [...new Set(menuItems.map((item) => item.category))];
    return ["Popular", ...categories.filter((category) => category !== "Popular")];
  }, [menuItems]);

  const visibleItems = useMemo(() => activeCategory === "Popular"
    ? menuItems.slice(0, 5)
    : menuItems.filter((item) => item.category === activeCategory), [activeCategory, menuItems]);

  const subtotal = getCartTotal();
  const count = cartItems.reduce((sum, line) => sum + line.quantity, 0);
  const memberCount = session?.guestCount ?? 1;
  const equalShare = Math.ceil(subtotal / memberCount);

  const selectionsFor = useCallback((item: MenuItem) => {
    const selected = optionSelections[item.id] ?? {};
    const values: Record<string, string | string[]> = {};
    for (const group of item.optionGroups) {
      const value = selected[group.option_key];
      if (value !== undefined && value !== "") values[group.option_key] = value;
      else if (group.min_selections > 0 && group.menu_options.length) {
        const defaults = group.menu_options.slice(0, group.min_selections).map((option) => option.option_key);
        values[group.option_key] = group.max_selections === 1 ? defaults[0] : defaults;
      }
    }
    return values;
  }, [optionSelections]);

  const handleAddToCart = useCallback(async (item: MenuItem) => {
    setActionError(null);
    try {
      await addToCart(item.id, 1, selectionsFor(item));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not add this item.");
    }
  }, [addToCart, selectionsFor]);

  const changeLineQuantity = useCallback(async (line: CartItem, delta: number) => {
    if (!line.isMine) return;
    setActionError(null);
    try {
      const nextQuantity = line.quantity + delta;
      if (nextQuantity < 1) await removeCartItem(line.id);
      else await updateCartItemQuantity(line.id, nextQuantity);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update this cart line.");
    }
  }, [removeCartItem, updateCartItemQuantity]);

  const optionSummary = (itemId: string, selections: Record<string, string | string[]>) => {
    const item = menuItems.find((candidate) => candidate.id === itemId);
    if (!item) return "";
    return item.optionGroups.flatMap((group) => {
      const value = selections[group.option_key];
      const keys = Array.isArray(value) ? value : value ? [value] : [];
      return keys.map((key) => group.menu_options.find((option) => option.option_key === key)?.label ?? key);
    }).join(" · ");
  };

  const menuItemPrice = (item: MenuItem) => item.base_price_paise + item.optionGroups.reduce((sum, group) => {
    const selected = selectionsFor(item)[group.option_key];
    const keys = Array.isArray(selected) ? selected : selected ? [selected] : [];
    return sum + keys.reduce((groupSum, key) => groupSum + (group.menu_options.find((option) => option.option_key === key)?.price_delta_paise ?? 0), 0);
  }, 0);

  const setViewAndClose = (next: View) => {
    if (next !== "tracking" && getOrderIdFromSearch(window.location.search)) {
      router.replace("/", { scroll: false });
    }
    setView(next);
    setShowCart(false);
    setActionError(null);
  };

  const showOrder = useCallback((id: string) => {
    const path = orderTrackingPath(id);
    if (!path) throw new Error("The order service returned an invalid order identifier.");
    router.replace(path, { scroll: false });
    setOrderId(id);
    setOrder(null);
    setView("tracking");
  }, [router]);

  const submitPendingOrder = useCallback(async (pending: ReturnType<typeof createPendingSubmission>) => {
    if (orderRequestInFlight.current) return;
    orderRequestInFlight.current = true;
    setCheckoutPending(true);
    setCheckoutError(null);
    try {
      const { data, error } = await supabase.rpc("submit_order", {
        p_session_id: pending.sessionId,
        p_payment_mode: pending.paymentMode,
        p_idempotency_key: pending.idempotencyKey,
        p_guest_note: pending.guestNote || null,
      });
      if (error) throw error;
      const result = getRpcRow<{ order_id: string }>(data);
      if (!result.order_id) throw new Error("The order service returned no order identifier.");
      sessionStorage.removeItem(`hotel-amrut-pending-order:${pending.sessionId}`);
      showOrder(result.order_id);
      await refreshCart();
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Order submission failed. Retry to safely check the same order.");
    } finally {
      orderRequestInFlight.current = false;
      setCheckoutPending(false);
    }
  }, [refreshCart, showOrder, supabase]);

  useEffect(() => {
    if (!session || restoredOrderState.current) return;
    const restoreTimer = window.setTimeout(() => {
      restoredOrderState.current = true;
      const orderFromUrl = getOrderIdFromSearch(window.location.search);
      if (orderFromUrl) {
        setOrderId(orderFromUrl);
        setView("tracking");
        return;
      }

      const storageKey = `hotel-amrut-pending-order:${session.sessionId}`;
      let pending;
      try {
        pending = parsePendingSubmission(sessionStorage.getItem(storageKey), session.sessionId);
      } catch {
        setView("checkout");
        setCheckoutError("This browser could not restore the pending order safely. Reopen checkout to retry.");
        return;
      }
      if (!pending) return;
      setPaymentMode(pending.paymentMode);
      setGuestNote(pending.guestNote);
      setView("checkout");
      void submitPendingOrder(pending);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [session, submitPendingOrder]);

  const refreshOrder = useCallback(async (id: string, showLoading: boolean) => {
    if (showLoading) setOrderLoading(true);
    setOrderError(null);
    try {
      const { data, error } = await supabase.rpc("get_order_status", { p_order_id: id });
      if (error) throw error;
      setOrder(getRpcRow<OrderStatusRow>(data));
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Could not load this order's status.");
    } finally {
      if (showLoading) setOrderLoading(false);
    }
  }, [supabase]);

  const refreshOrderQueue = useMemo(() => createSingleFlight(refreshOrder), [refreshOrder]);

  useEffect(() => {
    if (view !== "tracking" || !orderId) return;
    const initialRefresh = window.setTimeout(() => void refreshOrderQueue(orderId, true), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshOrderQueue(orderId, false);
    }, 5000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshOrderQueue(orderId, false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [view, orderId, refreshOrderQueue]);

  useEffect(() => {
    if (!showCart) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = cartDialogRef.current;
    if (!dialog) return;
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    getFocusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCart(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [showCart]);

  useEffect(() => {
    if (view !== "history" || !session) return;
    let active = true;
    const loadHistory = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      const { data, error } = await supabase.from("orders")
        .select("id,status,subtotal_paise,placed_at")
        .eq("session_id", session.sessionId)
        .order("placed_at", { ascending: false });
      if (!active) return;
      if (error) setHistoryError("Could not load this table's order history.");
      else setHistory(data ?? []);
      setHistoryLoading(false);
    };
    void loadHistory();
    return () => { active = false; };
  }, [view, session, supabase]);

  const submitOrder = async () => {
    if (!session || checkoutPending || !count) return;
    try {
      const storageKey = `hotel-amrut-pending-order:${session.sessionId}`;
      let pending: ReturnType<typeof createPendingSubmission> | null = null;
      try {
        pending = parsePendingSubmission(sessionStorage.getItem(storageKey), session.sessionId);
      } catch {
        throw new Error("This browser cannot save a safe retry key. Enable session storage and try again.");
      }
      if (!pending) {
        pending = createPendingSubmission(session.sessionId, paymentMode, guestNote, crypto.randomUUID());
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(pending));
        } catch {
          throw new Error("This browser cannot save a safe retry key. Enable session storage and try again.");
        }
      } else {
        setPaymentMode(pending.paymentMode);
        setGuestNote(pending.guestNote);
      }
      await submitPendingOrder(pending);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Order submission failed. Please retry.");
    }
  };

  if (sessionLoading) {
    return <main className="app-shell"><div className="join-loading"><div className="join-spinner" aria-busy="true" aria-label="Loading…"/><p>Preparing your table…</p></div></main>;
  }

  if (!session) {
    return (
      <main className="app-shell">
        <header className="topbar"><Link className="brand" href="/" aria-label="Hotel Amrut home"><span className="brand-mark">A<span>·</span></span><span className="brand-name">HOTEL AMRUT<small>KARWAR · COASTAL KITCHEN</small></span></Link></header>
        {sessionError && <div className="prototype-note" role="alert">{sessionError} <button className="text-link" onClick={() => void refreshSession()}>Retry session check</button></div>}
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span/> A TASTE OF THE KARWAR COAST</div><h1>Good food.<br/><em>Better together.</em></h1><p>Scan the QR code on your table to join the shared order.</p><Link className="primary-button" href="/join">Enter your table invite <Icon name="arrow"/></Link></div><div className="hero-image" role="img" aria-label="A colorful coastal meal served for sharing"><div className="hero-image-label"><span>01 / 07</span> MADE FOR SHARING</div></div><div className="hero-note"><span className="note-rule"/> A little coastal comfort,<br/>right where you are.</div></section>
        <div className="prototype-note"><span className="prototype-dot"/> JOIN YOUR TABLE TO BEGIN</div>
      </main>
    );
  }

  const statusProgress = order ? getOrderProgress(order.status) : -1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setViewAndClose("menu")} aria-label="Hotel Amrut home"><span className="brand-mark">A<span>·</span></span><span className="brand-name">HOTEL AMRUT<small>KARWAR · COASTAL KITCHEN</small></span></button>
        <div className="table-pill"><span className="live-dot"/> YOUR TABLE <b>{session.tableLabel}</b><span className="table-separator"/> <span className="guest-mini">{session.guestCount} {session.guestCount === 1 ? "guest" : "guests"}</span></div>
        <button className="history-link" onClick={() => setViewAndClose("history")}><Icon name="clock"/><span>Past orders</span></button>
      </header>

      {view === "menu" && <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span/> A TASTE OF THE KARWAR COAST</div><h1>Good food.<br/><em>Better together.</em></h1><p>Make yourself at home. Add to the table&apos;s order whenever you&apos;re ready.</p><button className="text-link" onClick={() => setShowCart(true)}>See what&apos;s on our table <Icon name="arrow"/></button></div><div className="hero-image" role="img" aria-label="A colorful coastal meal served for sharing"><div className="hero-image-label"><span>01 / 07</span> MADE FOR SHARING</div></div><div className="hero-note"><span className="note-rule"/> A little coastal comfort,<br/>right where you are.</div></section>
        <div className="prototype-note"><span className="prototype-dot"/> DEMO MENU · Confirm items, images, prices and availability with restaurant staff</div>
        <section className="menu-section"><div className="section-heading"><div><div className="eyebrow">FROM OUR KITCHEN</div><h2>Find your <em>favourite.</em></h2></div><p>Good things are best shared.<br/>Take a look around.</p></div>
          <nav className="category-tabs" aria-label="Menu categories">{menuCategories.map((category) => <button key={category} type="button" aria-pressed={activeCategory === category} className={activeCategory === category ? "category active" : "category"} onClick={() => setActiveCategory(category)}>{category}</button>)}</nav>
          {menuLoading ? <div className="menu-grid-loading">Loading menu…</div> : menuError ? <div className="empty-menu" role="alert">{menuError}<button className="text-link" onClick={() => window.location.reload()}>Try again <Icon name="arrow"/></button></div> : <div className="menu-grid">{visibleItems.map((item, index) => {
            const quantity = cartItems.filter((line) => line.menuItemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
            return <article className="menu-card" key={item.id} style={{ animationDelay: `${index * 55}ms` }}>
              <div className={`dish-image dish-${item.item_code.toLowerCase().replace(/[^a-z0-9]/g, "-")}`} style={item.image_url ? { backgroundImage: `url("${item.image_url}")` } : undefined}>{item.tag && <span className="dish-tag">{item.tag}</span>}<button className="quick-add" aria-label={`Add ${item.name}`} onClick={() => void handleAddToCart(item)}>{quantity ? <><Icon name="check"/> {quantity}</> : <Icon name="plus"/>}</button></div>
              <div className="dish-info"><div><h3>{item.name}</h3><p>{item.description}</p></div><strong>{formatINR(menuItemPrice(item))}</strong></div>
              {item.optionGroups.map((group) => {
                const current = selectionsFor(item)[group.option_key];
                const selectedKeys = Array.isArray(current) ? current : current ? [current] : [];
                return <div className="dish-preference" key={group.id}><span>{group.label.toUpperCase()}</span>{group.max_selections === 1
                  ? <select aria-label={`${group.label} for ${item.name}`} value={selectedKeys[0] ?? ""} onChange={(event) => setOptionSelections((state) => ({ ...state, [item.id]: { ...state[item.id], [group.option_key]: event.target.value } }))}>{group.min_selections === 0 && <option value="">No preference</option>}{group.menu_options.map((option) => <option value={option.option_key} key={option.id}>{option.label}{option.price_delta_paise ? ` (+${formatINR(option.price_delta_paise)})` : ""}</option>)}</select>
                  : <div className="option-multi">{group.menu_options.map((option) => <label key={option.id}><input type="checkbox" checked={selectedKeys.includes(option.option_key)} disabled={(!selectedKeys.includes(option.option_key) && selectedKeys.length >= group.max_selections) || (selectedKeys.includes(option.option_key) && selectedKeys.length <= group.min_selections)} onChange={(event) => setOptionSelections((state) => {
                    const previous = state[item.id]?.[group.option_key];
                    const keys = previous === undefined
                      ? group.menu_options.slice(0, group.min_selections).map((entry) => entry.option_key)
                      : Array.isArray(previous) ? previous : previous ? [previous] : [];
                    const next = event.target.checked ? [...keys, option.option_key] : keys.filter((key) => key !== option.option_key);
                    return { ...state, [item.id]: { ...state[item.id], [group.option_key]: next } };
                  })}/>{option.label}{option.price_delta_paise ? ` (+${formatINR(option.price_delta_paise)})` : ""}</label>)}</div>}
                </div>;
              })}
            </article>;
          })}</div>}
          {!menuLoading && !menuError && !visibleItems.length && <div className="empty-menu">We&apos;re still adding to this section. Have a look at our popular picks.</div>}
        </section>
        <section className="together-strip"><div className="together-icon">✳</div><div><span className="eyebrow">ONE TABLE, ONE ORDER</span><h2>Everyone gets a say.</h2><p>This basket is for everyone at your table. Cart changes refresh every three seconds while the page is open.</p></div><button className="outline-button" onClick={() => setShowCart(true)}>View shared order <Icon name="arrow"/></button></section>
        <section className="journey-strip"><div><span className="eyebrow">AFTER YOU ORDER</span><h2>We&apos;ll keep you <em>in the loop.</em></h2><p>Order status refreshes from the table service while this page is open.</p></div><div className="journey-steps">{ORDER_STEPS.map((step, index) => <div className="journey-step" key={step}><span className="step-dot">{`0${index + 1}`}</span><span>{step}</span></div>)}</div></section>
      </>}

      {view === "checkout" && <section className="flow-page"><button className="back-link" onClick={() => setViewAndClose("menu")}>← Back to menu</button><div className="flow-header"><div className="eyebrow">{session.tableLabel} · SHARED ORDER</div><h1>Let&apos;s settle <em>together.</em></h1><p>Choose how to record this simulated split. No payment will be collected.</p></div>
        <div className="checkout-layout"><div className="checkout-main"><div className="checkout-card"><div className="card-heading"><span>01</span><div><h3>How would you like to split this order?</h3><p>Payment is not processed by this demo.</p></div></div><div className="payment-options">{[
          { id: "one", title: "One person pays", detail: "Assign the total to you", icon: "◉" },
          { id: "equal", title: "Split it equally", detail: `Across ${memberCount} current table ${memberCount === 1 ? "guest" : "guests"}`, icon: "÷" },
          { id: "items", title: "By guest contributions", detail: "Each guest is assigned the items they added", icon: "☷" },
        ].map((option) => <button key={option.id} type="button" aria-pressed={paymentMode === option.id} className={`payment-option ${paymentMode === option.id ? "selected" : ""}`} onClick={() => setPaymentMode(option.id as PaymentMode)}><span className="payment-icon">{option.icon}</span><span><b>{option.title}</b><small>{option.detail}</small></span><span className="radio-mark"/></button>)}</div>
          {paymentMode === "items" && <div className="selected-items">{cartItems.map((line) => <div className="selected-item" key={line.id}><span>{line.quantity} × {line.name}<small> {optionSummary(line.menuItemId, line.optionSelections)} · {line.memberLabel}</small></span><b>{formatINR(line.lineTotalPaise)}</b></div>)}</div>}
        </div><div className="checkout-card preference-card"><div className="card-heading"><span>02</span><div><h3>A note for the kitchen?</h3><p>Optional note saved with this order.</p></div></div><textarea maxLength={500} value={guestNote} onChange={(event) => setGuestNote(event.target.value)} placeholder={"e.g. We'd prefer everything mild…"} aria-label="Food preferences"/></div></div>
          <aside className="bill-card"><div className="eyebrow">YOUR TABLE&apos;S ORDER</div><h3>{session.tableLabel}</h3>{cartItems.map((line) => <div className="bill-line" key={line.id}><span>{line.quantity} × {line.name}<small>{optionSummary(line.menuItemId, line.optionSelections)} · {line.memberLabel}</small></span><b>{formatINR(line.lineTotalPaise)}</b></div>)}<div className="bill-total"><span>{paymentMode === "equal" ? `Average · ${memberCount} guests` : "Order total"}</span><b>{formatINR(paymentMode === "equal" ? equalShare : subtotal)}</b></div><div className="mock-label">SIMULATED ALLOCATION · PAYMENT DISABLED</div>{(checkoutError || cartError) && <p className="inline-note" role="alert">{checkoutError || cartError}</p>}<button className="primary-button" disabled={!count || checkoutPending || cartLoading} onClick={() => void submitOrder()}>{checkoutPending ? "Placing order…" : count ? "Place table order" : "Add items to continue"}<Icon name="arrow"/></button><p className="safe-copy">This demo will not collect payment details.</p></aside></div>
      </section>}

      {view === "tracking" && <section className="flow-page tracking-page"><div className="tracking-top"><div className="tracking-icon"><span>✳</span></div><div className="eyebrow">{session.tableLabel} · ORDER {orderId?.slice(0, 8).toUpperCase()}</div><h1>{order ? "Your order." : "Loading your order."}<br/><em>{order?.status === "served" ? "Enjoy your meal." : order?.status === "cancelled" ? "This order was cancelled." : "We've got it from here."}</em></h1><p>{order ? `Placed by ${order.placed_by_member_label} · ${new Date(order.placed_at).toLocaleString()}` : "Checking the latest order status."}</p></div>
        {orderLoading && !order && <div className="menu-grid-loading">Loading order status…</div>}{orderError && <p className="inline-note" role="alert">{orderError} <button className="text-link" onClick={() => orderId && void refreshOrder(orderId, true)}>Retry</button></p>}
        {order && <>{order.status === "cancelled" ? <div className="inline-note">The restaurant cancelled this order. Ask staff for details.</div> : <div className="timeline">{ORDER_STEPS.map((label, index) => <div className={`timeline-step ${statusProgress >= index ? "current" : ""}`} key={label}><span className="timeline-marker">{statusProgress > index ? <Icon name="check"/> : <span>{`0${index + 1}`}</span>}</span><div><b>{label}</b><p>{statusProgress === index ? `Current status · ${order.status}` : statusProgress > index ? "Completed" : "Waiting for the previous step"}</p></div></div>)}</div>}<div className="bill-card"><div className="eyebrow">ORDER ITEMS</div>{order.order_items.map((item) => <div className="bill-line" key={item.id}><span>{item.quantity} × {item.name}</span><b>{formatINR(item.line_total_paise)}</b></div>)}<div className="bill-total"><span>Total · payment not collected</span><b>{formatINR(order.total_paise)}</b></div><div className="selected-items">{order.allocations.map((allocation) => <div className="selected-item" key={allocation.member_id}><span>{allocation.display_label} · {allocation.allocation_method} split</span><b>{formatINR(allocation.amount_paise)}</b></div>)}</div></div></>}
        <div className="notify-card"><div className="notify-bell">♧</div><div><b>Status refreshes while this page is open.</b><p>Updates are checked every five seconds. Reopen this order to fetch the latest status after reconnecting.</p></div></div><button className="outline-button" onClick={() => setViewAndClose("menu")}>Back to the menu <Icon name="arrow"/></button></section>}

      {view === "history" && <section className="flow-page history-page"><button className="back-link" onClick={() => setViewAndClose("menu")}>← Back to menu</button><div className="flow-header"><div className="eyebrow">YOUR TABLE, YOUR TIME</div><h1>A little <em>history.</em></h1><p>Orders for {session.tableLabel} are visible to current table members.</p></div>{historyLoading ? <div className="menu-grid-loading">Loading order history…</div> : historyError ? <p role="alert" className="inline-note">{historyError}</p> : history.length ? <div className="history-card"><div className="history-icon"><Icon name="clock"/></div><div>{history.map((item) => <div className="bill-line" key={item.id}><span>{item.status} · {new Date(item.placed_at).toLocaleString()}</span><b>{formatINR(item.subtotal_paise)}</b><button className="text-link" onClick={() => showOrder(item.id)}>Track order <Icon name="arrow"/></button></div>)}</div></div> : <div className="history-card"><div className="history-icon"><Icon name="clock"/></div><div><b>Nothing here just yet</b><p>Orders placed at this table will show here.</p></div><button className="text-link" onClick={() => setViewAndClose("menu")}>Explore the menu <Icon name="arrow"/></button></div>}</section>}

      {actionError && <p className="inline-note" role="alert">{actionError}</p>}
      <footer className="footer"><div className="footer-brand">HOTEL AMRUT <span>·</span> KARWAR</div><p>Good food has a way of bringing us together.</p><span>GUEST ORDERING DEMO · SESSION AND ORDER STATUS FROM SUPABASE</span></footer>

      {view === "menu" && <div className={`cart-dock ${count ? "has-items" : ""}`}><button className="dock-main" onClick={() => setShowCart(true)}><span className="dock-icon"><Icon name="bag"/>{count > 0 && <i>{count}</i>}</span><span className="dock-copy"><b>{count ? `${count} ${count === 1 ? "item" : "items"} for ${session.tableLabel}` : "Your table's order"}</b><small>{count ? "Shared cart · refreshes every 3 seconds" : "Nothing added yet · take a look"}</small></span><b className="dock-total">{formatINR(subtotal)}</b><span className="dock-arrow"><Icon name="arrow"/></span></button></div>}

      {showCart && <div className="drawer-scrim" role="presentation" onClick={() => setShowCart(false)}><section ref={cartDialogRef} className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">{session.tableLabel} · SHARED BASKET</span><h2 id="drawer-title">Good picks.</h2></div><button className="close-button" aria-label="Close basket" onClick={() => setShowCart(false)}><Icon name="close"/></button></div><div className={cartStyles.tabs} role="tablist"><button role="tab" aria-selected={cartTab === "shared"} className={`${cartStyles.tab} ${cartTab === "shared" ? cartStyles.active : ""}`} onClick={() => setCartTab("shared")}>Table Cart ({cartItems.reduce((sum, l) => sum + l.quantity, 0)})</button><button role="tab" aria-selected={cartTab === "mine"} className={`${cartStyles.tab} ${cartTab === "mine" ? cartStyles.active : ""}`} onClick={() => setCartTab("mine")}>My Items ({cartItems.filter((l) => l.isMine).reduce((sum, l) => sum + l.quantity, 0)})</button></div><div className="shared-callout"><span className="live-dot"/><div><b>One order for the table</b><p>Cart changes appear on other guests&apos; pages within about three seconds while open.</p></div></div>{cartError && <p className="inline-note" role="alert">{cartError}<button className="text-link" onClick={() => void refreshCart()}>Retry</button></p>}{drawerLines()}</section></div>}
    </main>
  );

  function drawerLines() {
    // Filter lines based on active cart tab
    const displayedLines = cartTab === "mine"
      ? cartItems.filter((line) => line.isMine)
      : cartItems;
    const displaySubtotal = cartTab === "mine"
      ? displayedLines.reduce((sum, l) => sum + l.lineTotalPaise, 0)
      : subtotal;

    if (cartLoading) return <div className="drawer-lines"><div className="empty-cart"><div className="join-spinner" aria-busy="true" aria-label="Loading cart…"/></div></div>;
    if (!displayedLines.length) {
      const emptyMessage = cartTab === "mine"
        ? "You haven't added anything yet. Browse the menu to pick your items."
        : "Add a favourite and it will show here for everyone at your table.";
      return <div className="drawer-lines"><div className="empty-cart"><span className="empty-cart-art">✳</span><h3>{cartTab === "mine" ? "No personal items yet" : "Room for something good."}</h3><p>{emptyMessage}</p><button className="text-link" onClick={() => setShowCart(false)}>Browse the menu <Icon name="arrow"/></button></div></div>;
    }
    return <><div className="drawer-lines">{displayedLines.map((line) => <div className="cart-line" key={line.id}><div className="cart-thumb" style={{ backgroundImage: `url("${menuItems.find((item) => item.id === line.menuItemId)?.image_url ?? ""}")` }}/><div className="cart-line-info"><b>{line.name}</b>{optionSummary(line.menuItemId, line.optionSelections) && <small>{optionSummary(line.menuItemId, line.optionSelections)}</small>}<small>{line.memberLabel}{line.isMine && cartTab === "mine" ? " · you" : ""}</small><strong>{formatINR(line.lineTotalPaise)}</strong></div>{line.isMine ? <div className="qty-control"><button aria-label={`Remove one ${line.name}`} onClick={() => void changeLineQuantity(line, -1)}><Icon name="minus"/></button><span>{line.quantity}</span><button aria-label={`Add one ${line.name}`} onClick={() => void changeLineQuantity(line, 1)}><Icon name="plus"/></button></div> : cartTab === "mine" ? <span className="mock-label">OTHER</span> : <span className="mock-label">GUEST CONTROL</span>}</div>)}</div><div className="drawer-bottom"><div className="subtotal-row"><span>{cartTab === "mine" ? "Your subtotal" : "Table subtotal"}</span><b>{formatINR(displaySubtotal)}</b></div><span className="mock-label">SHARED VIA DATABASE · 3 SECOND REFRESH</span>{cartTab === "shared" && <button className="primary-button" onClick={() => setViewAndClose("checkout")}>Choose how to split <Icon name="arrow"/></button>}</div></>;
  }
}
