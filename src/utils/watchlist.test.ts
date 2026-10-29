/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeWatchlist,
  DEFAULT_WATCHLIST_SYMBOLS,
  WATCHLIST_STORAGE_KEY,
} from './watchlist.ts';

test('[WATCHLIST] sanitizeWatchlist filters out unsupported or malformed symbols', () => {
  const input = ['^NSEI', 'INVALID_SYM', 'RELIANCE.NS', 123, null, '^NSEBANK'];
  const sanitized = sanitizeWatchlist(input);

  assert.deepEqual(sanitized, ['^NSEI', 'RELIANCE.NS', '^NSEBANK']);
});

test('[WATCHLIST] sanitizeWatchlist falls back to default list on invalid input', () => {
  assert.deepEqual(sanitizeWatchlist(null), DEFAULT_WATCHLIST_SYMBOLS);
  assert.deepEqual(sanitizeWatchlist('string'), DEFAULT_WATCHLIST_SYMBOLS);
  assert.deepEqual(sanitizeWatchlist({}), DEFAULT_WATCHLIST_SYMBOLS);
});

test('[WATCHLIST] default watchlist contains all 7 supported instruments', () => {
  assert.equal(DEFAULT_WATCHLIST_SYMBOLS.length, 7);
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('^NSEI'));
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('^NSEBANK'));
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('^BSESN'));
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('RELIANCE.NS'));
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('TCS.NS'));
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('INFY.NS'));
  assert.ok(DEFAULT_WATCHLIST_SYMBOLS.includes('HDFCBANK.NS'));
});
