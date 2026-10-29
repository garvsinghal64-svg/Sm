/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { YahooFinanceMarketProvider, SUPPORTED_INSTRUMENTS } from './marketDataProvider.ts';

test('[INTEGRATION] External Yahoo Finance Live Connectivity - Verifies live quotes for all 7 instruments', async () => {
  const provider = new YahooFinanceMarketProvider({
    baseUrl: 'https://query1.finance.yahoo.com',
    timeoutMs: 15000,
  });

  const result = await provider.getQuotes();
  assert.equal(result.quotes.length, 7, 'Received quotes for all 7 instruments');
  
  for (const quote of result.quotes) {
    assert.ok(typeof quote.price === 'number' && quote.price > 0, `${quote.symbol} has positive price: ${quote.price}`);
    assert.equal(quote.currency, 'INR', `${quote.symbol} is denominated in INR`);
    assert.ok(quote.quoteTimestamp > 0, `${quote.symbol} has valid epoch quoteTimestamp`);
    assert.ok(quote.quoteTimestampIST.includes('IST'), `${quote.symbol} has formatted IST quote timestamp`);
    assert.ok(quote.fetchedAtIST.includes('IST'), `${quote.symbol} has formatted IST fetch timestamp`);
    assert.equal(quote.dataDelayDisclosure, 'delay not verified', `${quote.symbol} delay is audited as delay not verified`);
  }
});
