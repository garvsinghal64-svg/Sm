/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  classifyFinancialSentiment,
  detectRelevantSymbols,
  categorizeNewsEvent,
  parseRSSXml,
  createDeterministicNewsFixture,
} from './newsService.ts';

test('[NEWS SENTIMENT] Rule-based sentiment extracts explicit keyword evidence', () => {
  const bullish = classifyFinancialSentiment('Tata Motors profit surges 45% as JLR revenue jumps');
  assert.strictEqual(bullish.sentiment, 'BULLISH');
  assert.ok(bullish.score > 0);
  assert.ok(bullish.evidence.some((e) => e.includes('surge')));
  assert.ok(bullish.evidence.some((e) => e.includes('jump')));

  const bearish = classifyFinancialSentiment('Adani Enterprises shares plunge 6% after SEBI issues regulatory notice');
  assert.strictEqual(bearish.sentiment, 'BEARISH');
  assert.ok(bearish.score < 0);
  assert.ok(bearish.evidence.some((e) => e.includes('plunge')));
  assert.ok(bearish.evidence.some((e) => e.includes('sebi')));

  const neutral = classifyFinancialSentiment('Reserve Bank of India to hold monetary policy meeting on Friday');
  assert.strictEqual(neutral.sentiment, 'NEUTRAL');
  assert.strictEqual(neutral.score, 0);
});

test('[NEWS RELEVANCE & CATEGORY] Maps companies to NSE symbols and event categories', () => {
  const symbols = detectRelevantSymbols('Reliance Industries and TCS sign strategic cloud contract');
  assert.ok(symbols.includes('RELIANCE.NS'));
  assert.ok(symbols.includes('TCS.NS'));

  const cat1 = categorizeNewsEvent('Infosys reports Q2 net profit beat');
  assert.strictEqual(cat1, 'EARNINGS_RESULTS');

  const cat2 = categorizeNewsEvent('L&T bags mega ₹4,000 crore hydrocarbon order from Middle East');
  assert.strictEqual(cat2, 'CONTRACT_ORDER_WIN');

  const cat3 = categorizeNewsEvent('SEBI introduces new margin and disclosure norms for algorithmic traders');
  assert.strictEqual(cat3, 'REGULATORY_SEBI');
});

test('[NEWS RSS PARSER & DEDUPLICATION] Parses XML and deduplicates syndicated stories', () => {
  const mockXml = `
    <rss version="2.0">
      <channel>
        <title>Google News</title>
        <item>
          <title><![CDATA[Sensex surges 400 pts as IT stocks rally]]></title>
          <link>https://news.google.com/article1</link>
          <pubDate>Thu, 29 Oct 2026 09:30:00 GMT</pubDate>
          <source url="https://economictimes.com">The Economic Times</source>
        </item>
        <item>
          <title>Sensex surges 400 pts as IT stocks rally</title>
          <link>https://news.google.com/article2</link>
          <pubDate>Thu, 29 Oct 2026 09:32:00 GMT</pubDate>
          <source url="https://moneycontrol.com">Moneycontrol Syndicated</source>
        </item>
        <item>
          <title>HDFC Bank opens 100 new branches across rural India</title>
          <link>https://news.google.com/article3</link>
          <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate>
          <source url="https://livemint.com">Livemint</source>
        </item>
      </channel>
    </rss>
  `;

  const parsed = parseRSSXml(mockXml);
  // Two identical headlines should be deduplicated to 1, plus the second item = 2 total
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].source, 'The Economic Times');
  assert.strictEqual(parsed[0].sentiment, 'BULLISH');
  assert.strictEqual(parsed[1].relevantSymbols.includes('HDFCBANK.NS'), true);
});

test('[NEWS FIXTURE] Fixture provides verified news items with no empty placeholders', () => {
  const fixture = createDeterministicNewsFixture();
  assert.ok(fixture.length >= 5);
  for (const item of fixture) {
    assert.ok(item.title.length > 10);
    assert.ok(item.source.length > 0);
    assert.strictEqual(item.isVerified, true);
    assert.ok(Number.isFinite(item.sentimentScore));
  }
});
