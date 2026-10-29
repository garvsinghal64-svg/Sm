/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { PaperTradingEngine } from './paperTrading.ts';
import { SetupCandidate } from './intradayScanner.ts';
import { PositionSizingResult } from './riskManagement.ts';
import { IntradayCandle } from '../services/intradayData.ts';

function createMockCandle(
  timestamp: number,
  timeString: string,
  open: number,
  high: number,
  low: number,
  close: number,
  sessionMinute: number
): IntradayCandle {
  return {
    timestamp,
    timestampIST: `2026-10-21 ${timeString}:00 IST`,
    dateString: '2026-10-21',
    timeString,
    open,
    high,
    low,
    close,
    volume: 50000,
    isComplete: true,
    sessionMinute,
    isValid: true,
  };
}

test('[STAGE 4F PAPER TRADING] Order execution, margin blocking, and statutory fee deduction', () => {
  const engine = new PaperTradingEngine(100000);

  const candidate: SetupCandidate = {
    id: 'TEST_LONG_1',
    symbol: 'RELIANCE.NS',
    name: 'Reliance Industries',
    exchange: 'NSE',
    isTradableCashEquity: true,
    timeframe: '5m',
    signalTimestamp: 1700000000000,
    signalTimestampIST: '2026-10-21 10:00:00 IST',
    setupType: 'VWAP_PULLBACK',
    direction: 'LONG',
    entryTriggerPrice: 2500,
    stopLossPrice: 2450,
    targetPrice: 2600,
    stopDistanceINR: 50,
    targetDistanceINR: 100,
    grossRiskRewardRatio: 2.0,
    estimatedCostBps: 20.6,
    estimatedCostINRPerShare: 5.15,
    netRewardRiskRatio: 1.85,
    indicators: {},
    reasonQualified: 'Test setup',
    invalidationCondition: 'Stop breach',
    signalExpiryIST: '2026-10-21 15:15:00 IST',
    status: 'QUALIFIED',
  };

  const sizing: PositionSizingResult = {
    isApproved: true,
    calculatedQuantity: 20,
    entryPrice: 2500,
    stopLossPrice: 2450,
    targetPrice: 2600,
    stopDistanceINR: 50,
    targetDistanceINR: 100,
    positionNotionalINR: 50000,
    marginRequiredINR: 10000,
    riskBudgetINR: 1000,
    capitalAllocationINR: 50000,
    estimatedRoundTripCostINR: 103,
    estimatedNetLossAtStopINR: 1103,
    estimatedNetProfitAtTargetINR: 1897,
    netRiskRewardRatio: 1.72,
    riskPolicyDisclosures: [],
  };

  const currentBar = createMockCandle(1700000000000, '10:00', 2500, 2510, 2495, 2500, 45);

  const exec = engine.executeCandidateOrder(candidate, sizing, currentBar);
  assert.strictEqual(exec.success, true);

  const state = engine.getState();
  assert.strictEqual(state.openPositions.length, 1);
  assert.strictEqual(state.openPositions[0].quantity, 20);
  assert.strictEqual(state.marginBlockedINR, 10000);
  assert.ok(state.availableCashINR < 90000); // 100k - 10k margin - entry fee
  assert.strictEqual(state.orderHistory.length, 1);
  assert.strictEqual(state.orderHistory[0].status, 'FILLED');
});

test('[STAGE 4F PAPER TRADING] Conservative collision resolution: Stop executed first if candle hits both target and stop', () => {
  const engine = new PaperTradingEngine(100000);

  const candidate: SetupCandidate = {
    id: 'COLLISION_TEST',
    symbol: 'TCS.NS',
    name: 'Tata Consultancy Services',
    exchange: 'NSE',
    isTradableCashEquity: true,
    timeframe: '5m',
    signalTimestamp: 1700000000000,
    signalTimestampIST: '2026-10-21 10:00:00 IST',
    setupType: 'OPENING_RANGE_BREAKOUT',
    direction: 'LONG',
    entryTriggerPrice: 3500,
    stopLossPrice: 3450,
    targetPrice: 3600,
    stopDistanceINR: 50,
    targetDistanceINR: 100,
    grossRiskRewardRatio: 2.0,
    estimatedCostBps: 20.6,
    estimatedCostINRPerShare: 7.2,
    netRewardRiskRatio: 1.8,
    indicators: {},
    reasonQualified: 'Test collision setup',
    invalidationCondition: 'Stop breach',
    signalExpiryIST: '2026-10-21 15:15:00 IST',
    status: 'QUALIFIED',
  };

  const sizing: PositionSizingResult = {
    isApproved: true,
    calculatedQuantity: 10,
    entryPrice: 3500,
    stopLossPrice: 3450,
    targetPrice: 3600,
    stopDistanceINR: 50,
    targetDistanceINR: 100,
    positionNotionalINR: 35000,
    marginRequiredINR: 7000,
    riskBudgetINR: 500,
    capitalAllocationINR: 35000,
    estimatedRoundTripCostINR: 72,
    estimatedNetLossAtStopINR: 572,
    estimatedNetProfitAtTargetINR: 928,
    netRiskRewardRatio: 1.62,
    riskPolicyDisclosures: [],
  };

  const entryBar = createMockCandle(1700000000000, '10:00', 3500, 3510, 3495, 3500, 45);
  engine.executeCandidateOrder(candidate, sizing, entryBar);

  // Incoming candle has High 3650 (penetrates target 3600) AND Low 3400 (penetrates stop 3450)!
  const collisionBar = createMockCandle(1700000300000, '10:05', 3500, 3650, 3400, 3550, 50);
  engine.evaluatePositionsOnBar(collisionBar);

  const state = engine.getState();
  assert.strictEqual(state.openPositions.length, 0); // closed
  assert.strictEqual(state.tradeJournal.length, 1);
  // Conservative rule must trigger STOP_LOSS first!
  assert.strictEqual(state.tradeJournal[0].exitReason, 'STOP_LOSS');
  assert.strictEqual(state.tradeJournal[0].exitPrice, 3450);
  assert.ok(state.tradeJournal[0].netPnLINR < 0);
});

test('[STAGE 4F PAPER TRADING] End of session auto square-off at 15:15 IST', () => {
  const engine = new PaperTradingEngine(100000);

  const candidate: SetupCandidate = {
    id: 'SQUARE_OFF_TEST',
    symbol: 'INFY.NS',
    name: 'Infosys Ltd',
    exchange: 'NSE',
    isTradableCashEquity: true,
    timeframe: '5m',
    signalTimestamp: 1700000000000,
    signalTimestampIST: '2026-10-21 14:00:00 IST',
    setupType: 'VWAP_PULLBACK',
    direction: 'LONG',
    entryTriggerPrice: 1500,
    stopLossPrice: 1470,
    targetPrice: 1560,
    stopDistanceINR: 30,
    targetDistanceINR: 60,
    grossRiskRewardRatio: 2.0,
    estimatedCostBps: 20.6,
    estimatedCostINRPerShare: 3.1,
    netRewardRiskRatio: 1.8,
    indicators: {},
    reasonQualified: 'Test square off',
    invalidationCondition: 'Stop breach',
    signalExpiryIST: '2026-10-21 15:15:00 IST',
    status: 'QUALIFIED',
  };

  const sizing: PositionSizingResult = {
    isApproved: true,
    calculatedQuantity: 20,
    entryPrice: 1500,
    stopLossPrice: 1470,
    targetPrice: 1560,
    stopDistanceINR: 30,
    targetDistanceINR: 60,
    positionNotionalINR: 30000,
    marginRequiredINR: 6000,
    riskBudgetINR: 600,
    capitalAllocationINR: 30000,
    estimatedRoundTripCostINR: 62,
    estimatedNetLossAtStopINR: 662,
    estimatedNetProfitAtTargetINR: 1138,
    netRiskRewardRatio: 1.72,
    riskPolicyDisclosures: [],
  };

  const entryBar = createMockCandle(1700000000000, '14:00', 1500, 1505, 1495, 1500, 285);
  engine.executeCandidateOrder(candidate, sizing, entryBar);

  // Bar at 15:15 IST (sessionMinute 360)
  const squareOffBar = createMockCandle(1700004500000, '15:15', 1510, 1515, 1508, 1512, 360);
  engine.evaluatePositionsOnBar(squareOffBar);

  const state = engine.getState();
  assert.strictEqual(state.openPositions.length, 0);
  assert.strictEqual(state.tradeJournal.length, 1);
  assert.strictEqual(state.tradeJournal[0].exitReason, 'AUTO_SQUARE_OFF');
  assert.strictEqual(state.tradeJournal[0].exitPrice, 1512);
});

test('[STAGE 4F ALERTS] Deduplicated alert emission', () => {
  const engine = new PaperTradingEngine(100000);
  engine.addAlert('ALERT_KEY_1', 'SIGNAL_ALERT', 'Test Title', 'Test Message', 'INFO');
  engine.addAlert('ALERT_KEY_1', 'SIGNAL_ALERT', 'Test Title Duplicate', 'Duplicate Message', 'INFO');

  const alerts = engine.getAlerts();
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].title, 'Test Title');
});
