"use client";

import { useMemo, useState } from "react";
import { formatINR, menuCategories, menuItems, type MenuItem } from "@/data/menu";

type CartLine = { item: MenuItem; qty: number; preference: string };
type View = "menu" | "checkout" | "tracking" | "history";

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

export default function Home() {
  const [activeCategory, setActiveCategory] = useState("Popular");
  const [view, setView] = useState<View>("menu");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [spiceByItem, setSpiceByItem] = useState<Record<string, string>>({});
  const [selectedLines, setSelectedLines] = useState<Record<string, boolean>>({});
  const [tableGuests, setTableGuests] = useState(4);
  const [paymentMode, setPaymentMode] = useState<"one" | "equal" | "items">("one");
  const [placed, setPlaced] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [review, setReview] = useState(0);

  const visibleItems = useMemo(() => activeCategory === "Popular"
    ? menuItems.slice(0, 5)
    : menuItems.filter((item) => item.category === activeCategory), [activeCategory]);
  const subtotal = cart.reduce((sum, line) => sum + line.item.pricePaise * line.qty, 0);
  const selectedSubtotal = cart.reduce((sum, line) => sum + (selectedLines[`${line.item.id}:${line.preference}`] === false ? 0 : line.item.pricePaise * line.qty), 0);
  const count = cart.reduce((sum, line) => sum + line.qty, 0);
  const equalShare = tableGuests ? Math.ceil(subtotal / tableGuests) : subtotal;

  function changeQty(item: MenuItem, delta: number, preference = "") {
    setCart((current) => {
      const key = `${item.id}:${preference}`;
      const existing = current.find((line) => `${line.item.id}:${line.preference}` === key);
      if (!existing && delta > 0) return [...current, { item, qty: 1, preference }];
      if (!existing) return current;
      return current.map((line) => `${line.item.id}:${line.preference}` === key ? { ...line, qty: line.qty + delta } : line).filter((line) => line.qty > 0);
    });
  }

  function add(item: MenuItem) {
    const preference = item.customizations ? (spiceByItem[item.id] ?? item.customizations[1]) : "";
    setSelectedLines((current) => ({ ...current, [`${item.id}:${preference}`]: true }));
    changeQty(item, 1, preference);
  }

  const setViewAndClose = (next: View) => { setView(next); setShowCart(false); };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setViewAndClose("menu")} aria-label="Hotel Amrut home">
          <span className="brand-mark">A<span>·</span></span>
          <span className="brand-name">HOTEL AMRUT<small>KARWAR · COASTAL KITCHEN</small></span>
        </button>
        <div className="table-pill"><span className="live-dot"/> YOUR TABLE <b>04</b><span className="table-separator"/> <span className="guest-mini">{tableGuests} guests</span></div>
        <button className="history-link" onClick={() => setViewAndClose("history")}><Icon name="clock"/><span>Past orders</span></button>
      </header>

      {view === "menu" && <>
        <section className="hero">
          <div className="hero-copy"><div className="eyebrow"><span/> A TASTE OF THE KARWAR COAST</div><h1>Good food.<br/><em>Better together.</em></h1><p>Make yourself at home. Add to the table’s order whenever you’re ready.</p>
            <button className="text-link" onClick={() => setShowCart(true)}>See what’s on our table <Icon name="arrow"/></button>
          </div>
          <div className="hero-image" role="img" aria-label="A colorful coastal meal served for sharing"><div className="hero-image-label"><span>01 / 07</span> MADE FOR SHARING</div></div>
          <div className="hero-note"><span className="note-rule"/> A little coastal comfort,<br/>right where you are.</div>
        </section>
        <div className="prototype-note"><span className="prototype-dot"/> SAMPLE MENU · Prices & dishes shown are illustrative</div>
        <section className="menu-section">
          <div className="section-heading"><div><div className="eyebrow">FROM OUR KITCHEN</div><h2>Find your <em>favourite.</em></h2></div><p>Good things are best shared.<br/>Take a look around.</p></div>
          <nav className="category-tabs" aria-label="Menu categories">{menuCategories.map((category) => <button key={category} className={activeCategory === category ? "category active" : "category"} onClick={() => setActiveCategory(category)}>{category}</button>)}</nav>
          <div className="menu-grid">{visibleItems.map((item, index) => {
            const qty = cart.filter((line) => line.item.id === item.id).reduce((sum, line) => sum + line.qty, 0);
            return <article className="menu-card" key={item.id} style={{ animationDelay: `${index * 55}ms` }}>
              <div className={`dish-image dish-${item.id}`} style={{ backgroundImage: `url("${item.image}")` }}>{item.tag && <span className="dish-tag">{item.tag}</span>}
                <button className="quick-add" aria-label={`Add ${item.name}`} onClick={() => add(item)}>{qty ? <><Icon name="check"/> {qty}</> : <Icon name="plus"/>}</button>
              </div>
              <div className="dish-info"><div><h3>{item.name}</h3><p>{item.description}</p></div><strong>{formatINR(item.pricePaise)}</strong></div>
              {item.customizations && <div className="dish-preference"><span>SPICE</span><select value={spiceByItem[item.id] ?? "Medium"} aria-label={`Spice preference for ${item.name}`} onChange={(event) => setSpiceByItem((current) => ({ ...current, [item.id]: event.target.value }))}><option>Medium</option><option>Mild</option><option>Spicy</option></select></div>}
            </article>;
          })}</div>
          {!visibleItems.length && <div className="empty-menu">We’re still adding to this section. Have a look at our popular picks.</div>}
        </section>
        <section className="together-strip"><div className="together-icon">✳</div><div><span className="eyebrow">ONE TABLE, ONE ORDER</span><h2>Everyone gets a say.</h2><p>This basket is for everyone at Table 04. Add your picks and let the table decide how to settle up.</p></div><button className="outline-button" onClick={() => setShowCart(true)}>View shared order <Icon name="arrow"/></button></section>
        <section className="journey-strip"><div><span className="eyebrow">AFTER YOU ORDER</span><h2>We’ll keep you <em>in the loop.</em></h2><p>Follow the order from kitchen to table. We’ll show the next step right here.</p></div><div className="journey-steps">{["Placed", "Preparing", "Ready", "Served"].map((step, index) => <div className="journey-step" key={step}><span className={index === 0 && placed ? "step-dot done" : "step-dot"}>{placed && index === 0 ? <Icon name="check"/> : `0${index + 1}`}</span><span>{step}</span></div>)}</div></section>
      </>}

      {view === "checkout" && <section className="flow-page"><button className="back-link" onClick={() => setViewAndClose("menu")}>← Back to menu</button><div className="flow-header"><div className="eyebrow">TABLE 04 · SHARED ORDER</div><h1>Let’s settle <em>together.</em></h1><p>Choose a way to split this prototype bill. No payment will be collected.</p></div>
        <div className="checkout-layout"><div className="checkout-main"><div className="checkout-card"><div className="card-heading"><span>01</span><div><h3>How would you like to pay?</h3><p>Pick whichever feels easiest for your table.</p></div></div><div className="payment-options">
          {[{ id: "one", title: "One person pays", detail: "One bill for the whole table", icon: "◉" }, { id: "equal", title: "Split it equally", detail: "Everyone pays an even share", icon: "÷" }, { id: "items", title: "Pay for your picks", detail: "Each person covers their own items", icon: "☷" }].map((option) => <button key={option.id} className={`payment-option ${paymentMode === option.id ? "selected" : ""}`} onClick={() => setPaymentMode(option.id as typeof paymentMode)}><span className="payment-icon">{option.icon}</span><span><b>{option.title}</b><small>{option.detail}</small></span><span className="radio-mark"/></button>)}
          {paymentMode === "equal" && <div className="guest-picker"><span>People at the table</span><div><button aria-label="One fewer guest" onClick={() => setTableGuests(Math.max(1, tableGuests - 1))}><Icon name="minus"/></button><b>{tableGuests}</b><button aria-label="One more guest" onClick={() => setTableGuests(Math.min(12, tableGuests + 1))}><Icon name="plus"/></button></div></div>}
          {paymentMode === "items" && <div className="selected-items">
            {cart.length === 0 ? <p className="inline-note">Add items to choose what you’d like to settle.</p> : cart.map((line) => <label className="selected-item" key={`${line.item.id}:${line.preference}`}>
              <input type="checkbox" checked={selectedLines[`${line.item.id}:${line.preference}`] !== false} onChange={(event) => setSelectedLines((current) => ({ ...current, [`${line.item.id}:${line.preference}`]: event.target.checked }))}/>
              <span>{line.qty} × {line.item.name}{line.preference && <small>{line.preference}</small>}</span>
              <b>{formatINR(line.item.pricePaise * line.qty)}</b>
            </label>)}
          </div>}
        </div><div className="checkout-card preference-card"><div className="card-heading"><span>02</span><div><h3>A note for the kitchen?</h3><p>Share preferences with your server.</p></div></div><textarea placeholder="e.g. We’d prefer everything mild…" aria-label="Food preferences"/></div></div></div>
          <aside className="bill-card"><div className="eyebrow">YOUR TABLE’S ORDER</div><h3>Table 04</h3>{cart.map((line) => <div className="bill-line" key={`${line.item.id}:${line.preference}`}><span>{line.qty} × {line.item.name}{line.preference && <small>{line.preference}</small>}</span><b>{formatINR(line.item.pricePaise * line.qty)}</b></div>)}<div className="bill-total"><span>{paymentMode === "equal" ? `Each · ${tableGuests} guests` : paymentMode === "items" ? "Your selected items" : "Total"}</span><b>{formatINR(paymentMode === "equal" ? equalShare : paymentMode === "items" ? selectedSubtotal : subtotal)}</b></div><div className="mock-label">PROTOTYPE ONLY · PAYMENT DISABLED</div><button className="primary-button" disabled={!count || (paymentMode === "items" && !selectedSubtotal)} onClick={() => { setPlaced(true); setView("tracking"); }}>{count ? "Place sample order" : "Add items to continue"}<Icon name="arrow"/></button><p className="safe-copy">This demo won’t process a payment.</p></aside></div>
      </section>}

      {view === "tracking" && <section className="flow-page tracking-page"><div className="tracking-top"><div className="tracking-icon"><span>✳</span></div><div className="eyebrow">TABLE 04 · ORDER AM-042</div><h1>{placed ? "Lovely choice." : "Your order."}<br/><em>{placed ? "We’ve got it from here." : "On its way."}</em></h1><p>{placed ? "Your sample order is in. The kitchen journey below is a preview." : "See each step as your food makes its way to the table."}</p></div><div className="timeline">{["Order placed", "Preparing", "Ready", "Served"].map((label, index) => <div className={`timeline-step ${index === 0 && placed ? "current" : ""}`} key={label}><span className="timeline-marker">{index === 0 && placed ? <Icon name="check"/> : <span>{`0${index + 1}`}</span>}</span><div><b>{label}</b><p>{index === 0 && placed ? "Just now · Sample status" : index === 1 ? "The kitchen update will appear here" : "We’ll let your table know"}</p></div></div>)}</div><div className="notify-card"><div className="notify-bell">♧</div><div><b>Stay in the moment.</b><p>We’ll show when the food is getting close. Automatic Do Not Disturb is not enabled.</p></div></div><div className="review-card"><span className="eyebrow">AFTER YOUR MEAL</span><h2>How was your <em>time with us?</em></h2><p>Leave a little note for the team when you’re ready.</p><div className="stars" aria-label="Rate your experience">{[1, 2, 3, 4, 5].map((star) => <button key={star} aria-label={`${star} stars`} onClick={() => setReview(star)} className={review >= star ? "lit" : ""}><Icon name="star"/></button>)}</div>{review > 0 && <span className="thanks">Thank you for sharing a {review}-star rating. (Demo)</span>}</div><button className="outline-button" onClick={() => setViewAndClose("menu")}>Back to the menu <Icon name="arrow"/></button></section>}

      {view === "history" && <section className="flow-page history-page"><button className="back-link" onClick={() => setViewAndClose("menu")}>← Back to menu</button><div className="flow-header"><div className="eyebrow">YOUR TABLE, YOUR TIME</div><h1>A little <em>history.</em></h1><p>Recent orders appear here on this device. No account needed.</p></div><div className="history-card"><div className="history-icon"><Icon name="clock"/></div><div><b>Nothing here just yet</b><p>Your table’s recent orders will show here once you’ve placed one.</p></div><button className="text-link" onClick={() => setViewAndClose("menu")}>Explore the menu <Icon name="arrow"/></button></div><span className="mock-label">THIS DEVICE ONLY · NO ORDER ACCOUNT</span></section>}

      <footer className="footer"><div className="footer-brand">HOTEL AMRUT <span>·</span> KARWAR</div><p>Good food has a way of bringing us together.</p><span>GUEST ORDERING PREVIEW · MOCK MENU</span></footer>

      {view === "menu" && <div className={`cart-dock ${count ? "has-items" : ""}`}><button className="dock-main" onClick={() => setShowCart(true)}><span className="dock-icon"><Icon name="bag"/>{count > 0 && <i>{count}</i>}</span><span className="dock-copy"><b>{count ? `${count} ${count === 1 ? "item" : "items"} for Table 04` : "Your table’s order"}</b><small>{count ? "Shared basket · prototype" : "Nothing added yet · take a look"}</small></span><b className="dock-total">{formatINR(subtotal)}</b><span className="dock-arrow"><Icon name="arrow"/></span></button></div>}

      {showCart && <div className="drawer-scrim" role="presentation" onClick={() => setShowCart(false)}><section className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">TABLE 04 · SHARED BASKET</span><h2 id="drawer-title">Good picks.</h2></div><button className="close-button" aria-label="Close basket" onClick={() => setShowCart(false)}><Icon name="close"/></button></div><div className="shared-callout"><span className="live-dot"/><div><b>One order for the table</b><p>This basket lives on this device in the demo. It isn’t synced to other guests.</p></div></div><div className="drawer-lines">{cart.length ? cart.map((line) => <div className="cart-line" key={`${line.item.id}:${line.preference}`}><div className="cart-thumb" style={{ backgroundImage: `url("${line.item.image}")` }}/><div className="cart-line-info"><b>{line.item.name}</b>{line.preference && <small>{line.preference} · spice</small>}<strong>{formatINR(line.item.pricePaise * line.qty)}</strong></div><div className="qty-control"><button aria-label={`Remove one ${line.item.name}`} onClick={() => changeQty(line.item, -1, line.preference)}><Icon name="minus"/></button><span>{line.qty}</span><button aria-label={`Add one ${line.item.name}`} onClick={() => changeQty(line.item, 1, line.preference)}><Icon name="plus"/></button></div></div>) : <div className="empty-cart"><span className="empty-cart-art">✳</span><h3>Room for something good.</h3><p>Add a favourite and it’ll show up here for everyone at your table.</p><button className="text-link" onClick={() => setShowCart(false)}>Browse the menu <Icon name="arrow"/></button></div>}</div>{!!count && <div className="drawer-bottom"><div className="subtotal-row"><span>Table subtotal</span><b>{formatINR(subtotal)}</b></div><span className="mock-label">LOCAL DEMO · NOT SYNCED BETWEEN DEVICES</span><button className="primary-button" onClick={() => setViewAndClose("checkout")}>Choose how to pay <Icon name="arrow"/></button></div>}</section></div>}
    </main>
  );
}
