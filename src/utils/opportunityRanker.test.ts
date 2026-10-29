/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  calculateCandidateScore,
  rankIntradayOpportunities,
  buildIntradayTradePlan,
} from './opportunityRanker.ts';
import { SetupCandidate } from './intradayScanner.ts';
import { createDeterministicMacroFixture, assessMacroRegime } from '../services/globalMarketData.ts';
import { createDeterministicNewsFixture } from '../services/newsService.ts';

function createMockCandidate(overrides: Partial<SetupCandidate> = {}): SetupCandidate {
  return {
    id: 'RELIANCE_VWAP_MOCK',
    symbol: 'RELIANCE.NS',
    name: 'Reliance Industries Ltd',
    exchange: 'NSE',
    isTradableCashEquity: true,
    timeframe: '5m',
    signalTimestamp: 1793268000000,
    signalTimestampIST: '2026-10-29 10:15:00 IST',
    setupType: 'VWAP_PULLBACK',
    direction: 'LONG',
    entryTriggerPrice: 2500,
    stopLossPrice: 2470,
    targetPrice: 2560,
    stopDistanceINR: 30,
    targetDistanceINR: 60,
    grossRiskRewardRatio: 2.0,
    estimatedCostBps: 15,
    estimatedCostINRPerShare: 3.75,
    netRewardRiskRatio: 1.75,
    indicators: {
      vwap: 2495,
      rsi14: 58,
      volumeMultiplier: 2.1,
    },
    reasonQualified: 'Price pulled back to VWAP with strong RSI',
    invalidationCondition: 'Close below VWAP stop at 2470',
    signalExpiryIST: '2026-10-29 15:15:00 IST',
    status: 'QUALIFIED',
    ...overrides,
  };
}

test('[OPPORTUNITY RANKER] Candidate scoring awards high score to qualified, high R:R setups', () => {
  const cand = createMockCandidate();
  const macro = assessMacroRegime(createDeterministicMacroFixture());
  const news = createDeterministicNewsFixture();

  const score = calculateCandidateScore(cand, macro, news);

  assert.ok(score.totalScore >= 65, 'Strong setup should score >= 65/100');
  assert.ok(score.setupQualityScore >= 20);
  assert.ok(score.trendAlignmentScore >= 15);
  assert.ok(score.volumeConfirmationScore >= 10);
  assert.ok(score.momentumScore >= 10);
});

test('[OPPORTUNITY RANKER] Decision Engine returns STRONG_QUALIFIED_SETUP and builds complete trade plan', () => {
  const candidates = [
    createMockCandidate({ symbol: 'RELIANCE.NS', netRewardRiskRatio: 1.8 }),
    createMockCandidate({ symbol: 'INFY.NS', netRewardRiskRatio: 1.2, status: 'QUALIFIED' }),
    createMockCandidate({ symbol: '^NSEI', isTradableCashEquity: false, status: 'DISQUALIFIED' }),
  ];

  const result = rankIntradayOpportunities(candidates, {
    accountEquityINR: 100000,
    availableCashINR: 100000,
    isMarketOpen: true,
  });

  assert.strictEqual(result.verdict, 'STRONG_QUALIFIED_SETUP');
  assert.ok(result.topOpportunity !== null);
  assert.strictEqual(result.topOpportunity.candidate.symbol, 'RELIANCE.NS');
  assert.strictEqual(result.disqualifiedIndexProxyCount, 1);

  // Verify Trade Plan
  const plan = result.topOpportunity.tradePlan;
  assert.ok(plan !== undefined);
  assert.strictEqual(plan.symbol, 'RELIANCE.NS');
  assert.ok(plan.calculatedQuantity > 0);
  assert.ok(plan.requiredMarginINR > 0);
  assert.ok(plan.statutoryFeeBreakdownINR.totalStatutoryChargesINR > 0);
  assert.ok(plan.exitRules.mandatorySquareOffIST.includes('15:15:00 IST'));
});

test('[OPPORTUNITY RANKER] Decision Engine returns explicit NO_TRADE when market is closed or no setup qualifies', () => {
  const candidates = [createMockCandidate()];

  // Case 1: Market closed
  const closedResult = rankIntradayOpportunities(candidates, {
    accountEquityINR: 100000,
    isMarketOpen: false,
  });
  assert.strictEqual(closedResult.verdict, 'NO_TRADE');
  assert.strictEqual(closedResult.topOpportunity, null);
  assert.ok(closedResult.verdictReason.includes('markets are currently closed'));

  // Case 2: No candidates pass gate (all low scores)
  const weakCandidates = [
    createMockCandidate({
      status: 'DISQUALIFIED',
      netRewardRiskRatio: 0.8,
      indicators: { volumeMultiplier: 0.5, rsi14: 85 },
    }),
  ];
  const weakResult = rankIntradayOpportunities(weakCandidates, {
    accountEquityINR: 100000,
    isMarketOpen: true,
  });
  assert.strictEqual(weakResult.verdict, 'NO_TRADE');
  assert.ok(weakResult.reasonsToAvoidTrading.length > 0);
});
