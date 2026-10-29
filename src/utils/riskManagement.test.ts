/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  calculateCompliantPositionSize,
  DEFAULT_RISK_CONFIG,
} from './riskManagement.ts';

test('[STAGE 4E RISK] Position sizing strictly adheres to 1% risk budget', () => {
  // Account ₹1,00,000, 1% risk = ₹1,000
  // Entry ₹2,500, Stop ₹2,450 (stop distance ₹50)
  // Expected raw qty = floor(1000 / 50) = 20 shares
  // Target ₹2,650 (target distance ₹150 -> 3:1 R:R)
  const result = calculateCompliantPositionSize(
    2500,
    2450,
    2650,
    'LONG',
    100000,
    100000,
    0,
    0,
    DEFAULT_RISK_CONFIG
  );

  assert.strictEqual(result.isApproved, true);
  assert.strictEqual(result.calculatedQuantity, 20);
  assert.strictEqual(result.stopDistanceINR, 50);
  assert.strictEqual(result.positionNotionalINR, 50000); // 20 * 2500 = 50,000 (within 50% cap)
  assert.strictEqual(result.marginRequiredINR, 10000); // 5x leverage -> 20% margin = 10,000
  assert.ok(result.netRiskRewardRatio >= 1.5);
});

test('[STAGE 4E RISK] Rejects trade if daily loss limit is breached', () => {
  // Max daily loss 3% = ₹3,000. Realized day P&L = -₹3,500
  const result = calculateCompliantPositionSize(
    2500,
    2450,
    2650,
    'LONG',
    100000,
    100000,
    0,
    -3500,
    DEFAULT_RISK_CONFIG
  );

  assert.strictEqual(result.isApproved, false);
  assert.strictEqual(result.calculatedQuantity, 0);
  assert.ok(result.rejectionReason?.includes('Daily loss limit'));
});

test('[STAGE 4E RISK] Rejects trade when max concurrent open positions is reached', () => {
  // Max concurrent = 3. Current open = 3.
  const result = calculateCompliantPositionSize(
    2500,
    2450,
    2650,
    'LONG',
    100000,
    100000,
    3,
    0,
    DEFAULT_RISK_CONFIG
  );

  assert.strictEqual(result.isApproved, false);
  assert.strictEqual(result.calculatedQuantity, 0);
  assert.ok(result.rejectionReason?.includes('Maximum concurrent open positions'));
});

test('[STAGE 4E RISK] Capped when required margin exceeds available cash', () => {
  // Available cash is only ₹2,000. Margin multiplier 5x -> max notional 10,000.
  // At ₹2,500/share -> max 4 shares.
  const result = calculateCompliantPositionSize(
    2500,
    2490, // stop dist ₹10 -> 100 shares raw
    2530,
    'LONG',
    100000,
    2000, // restricted cash
    0,
    0,
    DEFAULT_RISK_CONFIG
  );

  assert.strictEqual(result.isApproved, true);
  assert.strictEqual(result.calculatedQuantity, 4); // capped from 100 to 4
  assert.ok(result.riskPolicyDisclosures.some((d) => d.includes('cash margin')));
});
