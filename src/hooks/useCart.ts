"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSingleFlight } from "@/lib/order-helpers.mjs";
import { useTableSession } from "./useTableSession";

export type CartItem = {
  id: string;
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  unitPricePaise: number;
  priceVersion: number;
  optionSelections: Record<string, string | string[]>;
  lineTotalPaise: number;
  memberId: string;
  memberLabel: string;
  isMine: boolean;
};

export type CartState = {
  items: CartItem[];
  loading: boolean;
  error: string | null;
};

export function useCart() {
  const { session } = useTableSession();
  const sessionId = session?.sessionId;
  const supabase = createSupabaseBrowserClient();
  const [cartState, setCartState] = useState<CartState>({ items: [], loading: true, error: null });
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;

  const loadSessionCart = useCallback(async (requestedSessionId: string | undefined, showInitialLoading: boolean) => {
    if (!requestedSessionId) {
      if (currentSessionId.current === requestedSessionId) {
        setCartState({ items: [], loading: false, error: null });
      }
      return;
    }
    if (currentSessionId.current === requestedSessionId) {
      setCartState((previous) => ({
        ...previous,
        loading: showInitialLoading && previous.items.length === 0,
        error: null,
      }));
    }
    try {
      const { data, error } = await supabase.rpc("get_cart_lines", { p_session_id: requestedSessionId });
      if (error) throw error;
      const items: CartItem[] = (data ?? []).map((item: {
        cart_line_id: string;
        menu_item_id: string;
        menu_item_name: string;
        menu_item_category: string;
        quantity: number;
        unit_price_paise: number;
        price_version: number;
        option_selections: Record<string, string | string[]>;
        line_total_paise: number;
        member_id: string;
        member_label: string;
        is_mine: boolean;
      }) => ({
        id: item.cart_line_id,
        menuItemId: item.menu_item_id,
        name: item.menu_item_name,
        category: item.menu_item_category,
        quantity: item.quantity,
        unitPricePaise: item.unit_price_paise,
        priceVersion: item.price_version,
        optionSelections: item.option_selections,
        lineTotalPaise: item.line_total_paise,
        memberId: item.member_id,
        memberLabel: item.member_label,
        isMine: item.is_mine,
      }));
      if (currentSessionId.current === requestedSessionId) {
        setCartState({ items, loading: false, error: null });
      }
    } catch (err) {
      if (currentSessionId.current === requestedSessionId) {
        setCartState((previous) => ({
          ...previous,
          loading: false,
          error: err instanceof Error ? err.message : "Could not refresh the shared cart.",
        }));
      }
    }
  }, [supabase]);

  const refreshQueue = useMemo(() => createSingleFlight(loadSessionCart), [loadSessionCart]);
  const refresh = useCallback((showInitialLoading = false) => refreshQueue(sessionId, showInitialLoading), [refreshQueue, sessionId]);

  useEffect(() => {
    void refresh(true);
    if (!sessionId) return;

    // Poll while visible so other guests' changes appear without claiming Realtime support.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, 3000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId, refresh]);

  const runMutation = useCallback(async (operation: () => Promise<unknown>) => {
    try {
      const result = await operation();
      await refresh(false);
      return result;
    } catch (err) {
      setCartState((previous) => ({
        ...previous,
        error: err instanceof Error ? err.message : "Cart update failed. Please retry.",
      }));
      throw err;
    }
  }, [refresh]);

  const addToCart = useCallback(async (
    menuItemId: string,
    quantity = 1,
    optionSelections: Record<string, string | string[]> = {},
  ) => {
    if (!sessionId) throw new Error("Join an active table before ordering.");
    return runMutation(async () => {
      const { data, error } = await supabase.rpc("add_to_cart", {
        p_session_id: sessionId,
        p_menu_item_id: menuItemId,
        p_quantity: quantity,
        p_option_selections: optionSelections,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : null;
    });
  }, [sessionId, supabase, runMutation]);

  const updateCartItemQuantity = useCallback(async (cartItemId: string, quantity: number) => {
    return runMutation(async () => {
      const { data, error } = await supabase.rpc("update_cart_line", {
        p_cart_line_id: cartItemId,
        p_quantity: quantity,
      });
      if (error) throw error;
      return data;
    });
  }, [supabase, runMutation]);

  const removeCartItem = useCallback(async (cartItemId: string) => {
    return runMutation(async () => {
      const { data, error } = await supabase.rpc("remove_cart_line", { p_cart_line_id: cartItemId });
      if (error) throw error;
      return data;
    });
  }, [supabase, runMutation]);

  const clearCart = useCallback(async () => {
    if (!sessionId) throw new Error("Join an active table before ordering.");
    return runMutation(async () => {
      const { data, error } = await supabase.rpc("clear_cart", { p_session_id: sessionId });
      if (error) throw error;
      return data;
    });
  }, [sessionId, supabase, runMutation]);

  const getCartTotal = useCallback(
    () => cartState.items.reduce((sum, item) => sum + item.lineTotalPaise, 0),
    [cartState.items],
  );

  return {
    ...cartState,
    session,
    addToCart,
    updateCartItemQuantity,
    removeCartItem,
    clearCart,
    getCartTotal,
    refreshCart: () => refresh(true),
  };
}
