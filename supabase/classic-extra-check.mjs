// node supabase/classic-extra-check.mjs
import assert from 'node:assert/strict';
import { lengthSeconds, lengthError, tableFor } from './functions/_shared/lists.js';
import { toSnapshots } from '../FreeCLMain/src/shape.js';
for (const [value, seconds] of [['59', 59], ['59s', 59], ['1:00', 60], ['1m', 60], ['9m 59s', 599], ['9:59', 599], ['600s', 600], ['10:00', 600], ['1:60', null], ['', null], ['1.5', null]]) {
  assert.equal(lengthSeconds(value), seconds, value);
  assert.equal(!lengthError('classic', value), seconds !== null && seconds >= 1 && seconds <= 59, `TIMED: ${value}`);
  assert.equal(!lengthError('extra', value), seconds !== null && seconds >= 60 && seconds <= 599, `EXTRA: ${value}`);
}
assert.equal(lengthError('platformer', ''), '');
for (const name of ['maps', 'records', 'legacy_records', 'position_history', 'rankings', 'submissions', 'create_map', 'move_map', 'delete_map', 'approve_submission']) {
  assert.equal(tableFor('extra', name), `extra_${name}`);
  assert.equal(tableFor('classic', name), name);
}
// The same public level ID in two physical lists cannot share clears or legacy data.
const timed = toSnapshots([{ type: 'classic', level_id: '1', name: 'Timed' }], [{ level_id: '1', percent: 80, player: 'timed' }]);
const extra = toSnapshots([{ type: 'extra', level_id: '1', name: 'Extra' }], [{ level_id: '1', percent: 100, player: 'extra' }]);
assert.equal(timed.classic.clearers['1'][0].player, 'timed');
assert.equal(extra.extra.clearers['1'][0].player, 'extra');
assert.deepEqual(extra.classic.challenges, []);
assert.deepEqual(timed.extra.challenges, []);
console.log('CLASSIC boundaries, table routing and snapshot isolation passed.');
