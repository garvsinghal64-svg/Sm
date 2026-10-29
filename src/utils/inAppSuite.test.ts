/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { MarketUniverseManager, DEFAULT_NSE_UNIVERSE } from '../services/marketUniverse.ts';
import { createDeterministicMacroFixture, assessMacroRegime } from '../services/globalMarketData.ts';
import { classifyFinancialSentiment, createDeterministicNewsFixture } from '../services/newsService.ts';
import { calculateCandidateScore, rankIntradayOpportunities } from './opportunityRanker.ts';
import { createDeterministicIntradayFixture } from '../services/intradayData.ts';
import { scanIntradaySetups } from './intradayScanner.ts';

test('[IN-APP T57] Decision Engine Universe: Liquid Blue Chips, Custom Symbols & Tradability Tagging', () => {
  const mgr = new MarketUniverseManager([...DEFAULT_NSE_UNIVERSE]);
  const addRes = mgr.addSymbol('zomato');
  const dupRes = mgr.addSymbol('ZOMATO.NS');
  const tradable = mgr.getTradableEquities();
  const indices = mgr.getContextIndices();

  assert.ok(mgr.getAllInstruments().length >= 40);
  assert.strictEqual(addRes.success, true);
  assert.strictEqual(addRes.instrument?.symbol, 'ZOMATO.NS');
  assert.strictEqual(dupRes.success, false);
  assert.strictEqual(tradable.every((i) => i.type === 'EQUITY'), true);
  assert.strictEqual(indices.every((i) => i.type === 'INDEX'), true);
});

test('[IN-APP T58] Decision Engine Macro: Commodities, Currencies, World Indices & Sector Transmission', () => {
  const macro = createDeterministicMacroFixture();
  const regime = assessMacroRegime(macro);
  const crude = macro.find((i) => i.symbol === 'CL=F');
  const inr = macro.find((i) => i.symbol === 'INR=X');

  assert.strictEqual(macro.length, 9);
  assert.ok(crude !== undefined && crude.latestPrice !== null && crude.affectedSectors.length > 0);
  assert.ok(inr !== undefined && inr.latestPrice !== null && inr.transmissionMechanism.length > 20);
  assert.strictEqual(typeof regime.overallRegime, 'string');
});

test('[IN-APP T59] Decision Engine News: Verified RSS Intelligence & Transparent Keyword Sentiment', () => {
  const bullish = classifyFinancialSentiment('Tata Motors profit surges 45% as JLR revenue jumps');
  const bearish = classifyFinancialSentiment('Adani Enterprises shares plunge 6% after SEBI issues notice');
  const newsFixture = createDeterministicNewsFixture();

  assert.strictEqual(bullish.sentiment, 'BULLISH');
  assert.ok(bullish.evidence.length >= 2);
  assert.strictEqual(bearish.sentiment, 'BEARISH');
  assert.ok(bearish.evidence.length >= 1);
  assert.ok(newsFixture.length >= 5);
  assert.strictEqual(newsFixture.every((n) => n.isVerified), true);
});

test('[IN-APP T60] Decision Engine Ranker: 6-Factor Cross-Sectional Scoring System (0-100 Pts)', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);
  const setups = scanIntradaySetups(fixture);
  const cand = setups.find((s) => s.isTradableCashEquity) || setups[0];
  const regime = assessMacroRegime(createDeterministicMacroFixture());
  const news = createDeterministicNewsFixture();

  const score = calculateCandidateScore(cand, regime, news);

  assert.ok(score.totalScore >= 0 && score.totalScore <= 100);
  assert.ok(score.setupQualityScore >= 0);
  assert.ok(score.trendAlignmentScore >= 0);
  assert.ok(score.volumeConfirmationScore >= 0);
  assert.ok(score.scoringNotes.length > 0);
});

test('[IN-APP T61] Decision Engine Trade Plan: Entry Triggers, Sizing, Statutory MIS Costs & Square-Off', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);
  const setups = scanIntradaySetups(fixture);
  const cand = setups.find((s) => s.isTradableCashEquity) || setups[0];
  const regime = assessMacroRegime(createDeterministicMacroFixture());
  const news = createDeterministicNewsFixture();

  const rankResult = rankIntradayOpportunities([cand], {
    accountEquityINR: 100000,
    availableCashINR: 100000,
    isMarketOpen: true,
    regime,
    newsItems: news,
  });

  const plan = rankResult.topOpportunity?.tradePlan;
  assert.ok(plan !== undefined);
  assert.ok(plan.calculatedQuantity > 0);
  assert.ok(plan.requiredMarginINR > 0);
  assert.ok(plan.statutoryFeeBreakdownINR.totalStatutoryChargesINR > 0);
  assert.ok(plan.exitRules.mandatorySquareOffIST.includes('15:15:00 IST'));
});

test('[IN-APP T62] Decision Engine Guardrail: Non-Negotiable NO_TRADE Gate Enforcement', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);
  const setups = scanIntradaySetups(fixture);
  const cand = setups.find((s) => s.isTradableCashEquity) || setups[0];

  const closedDecision = rankIntradayOpportunities([cand], {
    accountEquityINR: 100000,
    isMarketOpen: false, // Closed market
  });

  assert.strictEqual(closedDecision.verdict, 'NO_TRADE');
  assert.strictEqual(closedDecision.topOpportunity, null);
  assert.ok(closedDecision.reasonsToAvoidTrading.length > 0);
});
