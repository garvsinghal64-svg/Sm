/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_INSTRUMENTS,
  YAHOO_PROVIDER_DISCLOSURES,
  parseYahooChartResponse,
  markQuoteAsPreservedStale,
  formatINR,
  formatVolume,
  formatISTTime,
  YahooFinanceMarketProvider,
} from './marketDataProvider.ts';

// Deterministic mock responses for all 7 supported instruments
const MOCK_CHARTS: Record<string, any> = {
  '^NSEI': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: '^NSEI',
            exchangeName: 'NSI',
            fullExchangeName: 'NSE',
            instrumentType: 'INDEX',
            regularMarketTime: 1792404088,
            regularMarketPrice: 22888.95,
            chartPreviousClose: 23146.2,
            regularMarketDayHigh: 23200.0,
            regularMarketDayLow: 22850.5,
            shortName: 'NIFTY 50',
            // exchangeDataDelayedBy is undefined in real payload
            currentTradingPeriod: {
              regular: { start: 1792381500, end: 1792404000 },
            },
          },
          indicators: { quote: [{ volume: [null] }] },
        },
      ],
      error: null,
    },
  },
  '^NSEBANK': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: '^NSEBANK',
            exchangeName: 'NSI',
            fullExchangeName: 'NSE',
            instrumentType: 'INDEX',
            regularMarketTime: 1792404088,
            regularMarketPrice: 55488.1,
            chartPreviousClose: 55844.0,
            regularMarketDayHigh: 56000.0,
            regularMarketDayLow: 55200.0,
            shortName: 'NIFTY BANK',
          },
          indicators: { quote: [{ volume: [null] }] },
        },
      ],
      error: null,
    },
  },
  '^BSESN': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: '^BSESN',
            exchangeName: 'BSE',
            fullExchangeName: 'BSE',
            instrumentType: 'INDEX',
            regularMarketTime: 1792404145,
            regularMarketPrice: 73852.9,
            chartPreviousClose: 74729.3,
            regularMarketDayHigh: 74800.0,
            regularMarketDayLow: 73500.0,
            shortName: 'S&P BSE SENSEX',
          },
          indicators: { quote: [{ volume: [null] }] },
        },
      ],
      error: null,
    },
  },
  'RELIANCE.NS': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: 'RELIANCE.NS',
            exchangeName: 'NSI',
            fullExchangeName: 'NSE',
            instrumentType: 'EQUITY',
            regularMarketTime: 1792403978,
            regularMarketPrice: 1202.0,
            chartPreviousClose: 1211.2,
            regularMarketDayHigh: 1228.2,
            regularMarketDayLow: 1201.0,
            regularMarketVolume: 15572554,
            shortName: 'RELIANCE INDUSTRIES LTD',
          },
          indicators: { quote: [{ volume: [15572554] }] },
        },
      ],
      error: null,
    },
  },
  'TCS.NS': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: 'TCS.NS',
            exchangeName: 'NSI',
            fullExchangeName: 'NSE',
            instrumentType: 'EQUITY',
            regularMarketTime: 1792403978,
            regularMarketPrice: 2460.9,
            chartPreviousClose: 2465.0,
            regularMarketDayHigh: 2480.0,
            regularMarketDayLow: 2450.0,
            regularMarketVolume: 3412000,
            shortName: 'TATA CONSULTANCY SERVICES',
          },
          indicators: { quote: [{ volume: [3412000] }] },
        },
      ],
      error: null,
    },
  },
  'INFY.NS': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: 'INFY.NS',
            exchangeName: 'NSI',
            fullExchangeName: 'NSE',
            instrumentType: 'EQUITY',
            regularMarketTime: 1792403978,
            regularMarketPrice: 1130.7,
            chartPreviousClose: 1161.2,
            regularMarketDayHigh: 1165.0,
            regularMarketDayLow: 1125.0,
            regularMarketVolume: 8200500,
            shortName: 'INFOSYS LTD',
          },
          indicators: { quote: [{ volume: [8200500] }] },
        },
      ],
      error: null,
    },
  },
  'HDFCBANK.NS': {
    chart: {
      result: [
        {
          meta: {
            currency: 'INR',
            symbol: 'HDFCBANK.NS',
            exchangeName: 'NSI',
            fullExchangeName: 'NSE',
            instrumentType: 'EQUITY',
            regularMarketTime: 1792403979,
            regularMarketPrice: 712.0,
            chartPreviousClose: 728.85,
            regularMarketDayHigh: 730.0,
            regularMarketDayLow: 710.0,
            regularMarketVolume: 22100000,
            shortName: 'HDFC BANK LTD',
          },
          indicators: { quote: [{ volume: [22100000] }] },
        },
      ],
      error: null,
    },
  },
};

test('1. Instruments Configuration - All 7 required instruments defined', () => {
  assert.equal(SUPPORTED_INSTRUMENTS.length, 7);
  const symbols = SUPPORTED_INSTRUMENTS.map((i) => i.symbol);
  assert.ok(symbols.includes('^NSEI'), 'Includes Nifty 50');
  assert.ok(symbols.includes('^NSEBANK'), 'Includes Bank Nifty');
  assert.ok(symbols.includes('^BSESN'), 'Includes Sensex');
  assert.ok(symbols.includes('RELIANCE.NS'), 'Includes Reliance');
  assert.ok(symbols.includes('TCS.NS'), 'Includes TCS');
  assert.ok(symbols.includes('INFY.NS'), 'Includes Infosys');
  assert.ok(symbols.includes('HDFCBANK.NS'), 'Includes HDFC Bank');
});

test('2. Response Parsing - All 7 instruments parse successfully and correctly', () => {
  for (const inst of SUPPORTED_INSTRUMENTS) {
    const raw = MOCK_CHARTS[inst.symbol];
    assert.ok(raw, `Mock payload exists for ${inst.symbol}`);
    const quote = parseYahooChartResponse(raw, inst.symbol, 1792404000000);

    assert.equal(quote.symbol, inst.symbol);
    assert.ok(quote.price > 0, `${inst.symbol} price is positive number`);
    assert.equal(quote.currency, 'INR');
    assert.equal(quote.exchange, inst.exchange);
    assert.equal(quote.type, inst.type);
    assert.ok(quote.quoteTimestamp > 0, `${inst.symbol} has source timestamp`);
    assert.ok(quote.quoteTimestampIST.includes('IST'));
    assert.ok(quote.fetchedAtIST.includes('IST'));
    // Since exchangeDataDelayedBy is undefined in real payload:
    assert.equal(quote.dataDelayDisclosure, 'delay not verified', 'Delay marked as delay not verified');
  }
});

test('3. Invalid Price Rejection - Throws on missing regularMarketPrice', () => {
  const bad = {
    chart: {
      result: [{ meta: { currency: 'INR', symbol: 'XYZ.NS' } }],
    },
  };
  assert.throws(
    () => parseYahooChartResponse(bad, 'XYZ.NS'),
    /Invalid or missing regularMarketPrice/
  );
});

test('4. Invalid Price Rejection - Throws on null, NaN, or non-numeric price', () => {
  const nullPrice = {
    chart: { result: [{ meta: { currency: 'INR', regularMarketPrice: null } }] },
  };
  assert.throws(
    () => parseYahooChartResponse(nullPrice, 'XYZ.NS'),
    /Invalid or missing regularMarketPrice/
  );

  const nanPrice = {
    chart: { result: [{ meta: { currency: 'INR', regularMarketPrice: NaN } }] },
  };
  assert.throws(
    () => parseYahooChartResponse(nanPrice, 'XYZ.NS'),
    /Invalid or missing regularMarketPrice/
  );

  const strPrice = {
    chart: { result: [{ meta: { currency: 'INR', regularMarketPrice: '1200.0' } }] },
  };
  assert.throws(
    () => parseYahooChartResponse(strPrice, 'XYZ.NS'),
    /Invalid or missing regularMarketPrice/
  );

  const negativePrice = {
    chart: { result: [{ meta: { currency: 'INR', regularMarketPrice: -50 } }] },
  };
  assert.throws(
    () => parseYahooChartResponse(negativePrice, 'XYZ.NS'),
    /Invalid or missing regularMarketPrice/
  );
});

test('5. Invalid Payload Rejection - Throws on empty result array or Yahoo error', () => {
  const errPayload = { chart: { result: null, error: { description: 'Symbol not found' } } };
  assert.throws(
    () => parseYahooChartResponse(errPayload, 'UNKNOWN.NS'),
    /Yahoo Finance error for UNKNOWN.NS: Symbol not found/
  );

  assert.throws(
    () => parseYahooChartResponse(null, 'UNKNOWN.NS'),
    /Invalid JSON response/
  );
});

test('6. Data Delay Auditing - Sets "delay not verified" when exchangeDataDelayedBy is undefined', () => {
  const raw = JSON.parse(JSON.stringify(MOCK_CHARTS['RELIANCE.NS']));
  delete raw.chart.result[0].meta.exchangeDataDelayedBy;
  const quote = parseYahooChartResponse(raw, 'RELIANCE.NS', 1792404000000);

  assert.equal(quote.dataDelayDisclosure, 'delay not verified');
  assert.equal(quote.exchangeDataDelayedBy, null);
});

test('7. Data Delay Auditing - Sets verifiable delay when exchangeDataDelayedBy is provided', () => {
  const raw = JSON.parse(JSON.stringify(MOCK_CHARTS['RELIANCE.NS']));
  raw.chart.result[0].meta.exchangeDataDelayedBy = 15;
  const quote = parseYahooChartResponse(raw, 'RELIANCE.NS', 1792404000000);

  assert.equal(quote.dataDelayDisclosure, '15m delay');
  assert.equal(quote.exchangeDataDelayedBy, 15);
});

test('8. Stale Data Labelling - Flags preserved stale quotes on failed refresh', () => {
  const quote = parseYahooChartResponse(MOCK_CHARTS['RELIANCE.NS'], 'RELIANCE.NS', 1792404000000);
  const preserved = markQuoteAsPreservedStale(quote, 'Network timeout 504 Gateway', 1792405000000);

  assert.equal(preserved.symbol, 'RELIANCE.NS');
  assert.equal(preserved.price, 1202.0);
  assert.equal(preserved.isDelayedOrStale, true);
  assert.equal(preserved.isPreservedStaleOnFailure, true);
  assert.equal(preserved.freshnessStatus, 'PRESERVED_STALE');
  assert.ok(preserved.staleReason.includes('Refresh failed'));
  assert.ok(preserved.staleReason.includes('Preserving previously fetched data'));
});

test('9. Formatting - Rupee formatting with Indian comma placement', () => {
  assert.equal(formatINR(22888.95), '₹22,888.95');
  assert.equal(formatINR(1202), '₹1,202.00');
  assert.equal(formatINR(null), '₹--');
});

test('10. Formatting - Volume formatting for Indian markets (Crores and Lakhs)', () => {
  assert.equal(formatVolume(15572554), '1.56 Cr');
  assert.equal(formatVolume(250000), '2.50 L');
  assert.equal(formatVolume(5000), '5,000');
  assert.equal(formatVolume(null), 'N/A');
});

test('11. Provider Request Deduplication - Simultaneous calls share identical in-flight Promise', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    await new Promise((r) => setTimeout(r, 50));
    return {
      ok: true,
      json: async () => MOCK_CHARTS['RELIANCE.NS'],
    } as any;
  };

  const provider = new YahooFinanceMarketProvider({
    baseUrl: 'https://mock.finance',
    fetchFn: mockFetch,
  });

  const [res1, res2] = await Promise.all([
    provider.getQuotes(['RELIANCE.NS']),
    provider.getQuotes(['RELIANCE.NS']),
  ]);

  assert.equal(res1, res2, 'Both calls shared identical Promise');
  assert.equal(callCount, 1, 'Only 1 underlying network fetch was initiated');
});

test('12. Failed Request Fallback - Preserves previous quotes when network fails', async () => {
  let shouldFail = false;
  const mockFetch = async () => {
    if (shouldFail) {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as any;
    }
    return {
      ok: true,
      json: async () => MOCK_CHARTS['RELIANCE.NS'],
    } as any;
  };

  const provider = new YahooFinanceMarketProvider({
    baseUrl: 'https://mock.finance',
    fetchFn: mockFetch,
  });

  const initial = await provider.getQuotes(['RELIANCE.NS']);
  assert.equal(initial.quotes[0].price, 1202.0);
  assert.equal(initial.quotes[0].isPreservedStaleOnFailure, false);

  shouldFail = true;
  const refreshed = await provider.getQuotes(['RELIANCE.NS']);

  assert.equal(refreshed.quotes.length, 1);
  assert.equal(refreshed.quotes[0].price, 1202.0);
  assert.equal(refreshed.quotes[0].isPreservedStaleOnFailure, true);
  assert.ok(refreshed.quotes[0].staleReason.includes('Refresh failed'));
  assert.ok(refreshed.errors['RELIANCE.NS'], 'Records specific symbol error');
});
