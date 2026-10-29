/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { SUPPORTED_INSTRUMENTS } from '../services/marketDataProvider.ts';

export const WATCHLIST_STORAGE_KEY = 'indian_stock_app_watchlist_v1';

// Default watchlist includes all 7 core instruments
export const DEFAULT_WATCHLIST_SYMBOLS = SUPPORTED_INSTRUMENTS.map((i) => i.symbol);

/**
 * Validates a list of symbols against supported instruments
 */
export function sanitizeWatchlist(symbols: unknown): string[] {
  if (!Array.isArray(symbols)) {
    return [...DEFAULT_WATCHLIST_SYMBOLS];
  }
  const validSet = new Set(SUPPORTED_INSTRUMENTS.map((i) => i.symbol));
  const filtered = symbols.filter((s): s is string => typeof s === 'string' && validSet.has(s));
  return filtered;
}

/**
 * Retrieve saved watchlist from localStorage safely (browser-safe, SSR-safe)
 */
export function getSavedWatchlist(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...DEFAULT_WATCHLIST_SYMBOLS];
  }

  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_WATCHLIST_SYMBOLS];
    }
    const parsed = JSON.parse(raw);
    return sanitizeWatchlist(parsed);
  } catch {
    return [...DEFAULT_WATCHLIST_SYMBOLS];
  }
}

/**
 * Save watchlist to localStorage
 */
export function saveWatchlist(symbols: string[]): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  try {
    const sanitized = sanitizeWatchlist(symbols);
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(sanitized));
    // Dispatch storage event for same-window updates
    window.dispatchEvent(new CustomEvent('watchlist_updated', { detail: sanitized }));
    return true;
  } catch (err) {
    console.error('Failed to save watchlist to localStorage:', err);
    return false;
  }
}

/**
 * React Hook for managing user's local watchlist
 */
export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>(() => getSavedWatchlist());

  useEffect(() => {
    // Listen for custom event or storage events across components
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (customEvent.detail && Array.isArray(customEvent.detail)) {
        setWatchlist(customEvent.detail);
      } else {
        setWatchlist(getSavedWatchlist());
      }
    };

    window.addEventListener('watchlist_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener('watchlist_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const isInWatchlist = useCallback(
    (symbol: string) => watchlist.includes(symbol),
    [watchlist]
  );

  const toggleSymbol = useCallback(
    (symbol: string) => {
      setWatchlist((prev) => {
        let updated: string[];
        if (prev.includes(symbol)) {
          updated = prev.filter((s) => s !== symbol);
        } else {
          updated = [...prev, symbol];
        }
        saveWatchlist(updated);
        return updated;
      });
    },
    []
  );

  const addToWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      if (prev.includes(symbol)) return prev;
      const updated = [...prev, symbol];
      saveWatchlist(updated);
      return updated;
    });
  }, []);

  const removeFromWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      const updated = prev.filter((s) => s !== symbol);
      saveWatchlist(updated);
      return updated;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    const def = [...DEFAULT_WATCHLIST_SYMBOLS];
    saveWatchlist(def);
    setWatchlist(def);
  }, []);

  return {
    watchlist,
    isInWatchlist,
    toggleSymbol,
    addToWatchlist,
    removeFromWatchlist,
    resetToDefault,
  };
}
