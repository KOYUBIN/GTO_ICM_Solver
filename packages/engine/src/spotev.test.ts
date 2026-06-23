import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shoveEv, openRaiseEv } from './spotev.js';

test('shoveEv: premium hands beat trash and shoving AA is +EV', () => {
  const params = { stackBB: 12, callPercent: 20, playersBehind: 2 } as const;
  const aa = shoveEv('AA', params);
  const trash = shoveEv('72o', params);

  assert.ok(aa.evShove > trash.evShove, `AA ${aa.evShove} vs 72o ${trash.evShove}`);
  assert.ok(aa.evShove > 0 && aa.best === 'shove');
  assert.ok(aa.equityVsCall > 0.8);
});

test('shoveEv: more fold equity (more % called) lowers fold equity term', () => {
  const tight = shoveEv('A5s', { stackBB: 15, callPercent: 8, playersBehind: 3 });
  const loose = shoveEv('A5s', { stackBB: 15, callPercent: 40, playersBehind: 3 });
  assert.ok(tight.foldEquity > loose.foldEquity);
});

test('openRaiseEv: premium opens are +EV and beat trash', () => {
  const params = { raiseTo: 2.5, continuePercent: 25, playersBehind: 3 } as const;
  const aa = openRaiseEv('AA', params);
  const trash = openRaiseEv('72o', params);
  assert.ok(aa > trash, `AA ${aa} vs 72o ${trash}`);
  assert.ok(aa > 0, `AA open should be +EV, got ${aa}`);
});
