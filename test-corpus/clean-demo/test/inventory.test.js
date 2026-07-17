import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, removeItem, totalQuantity, findItem, itemNames } from '../src/inventory.js';

test('addItem appends with a stable index', () => {
  const list = addItem([], { name: 'bolt', quantity: 4 });
  assert.equal(list.length, 1);
  assert.equal(list[0].addedAt, 0);
});

test('addItem rejects an item with no name', () => {
  assert.throws(() => addItem([], { quantity: 1 }));
});

test('removeItem drops the named entry', () => {
  const list = [{ name: 'bolt' }, { name: 'nut' }];
  assert.equal(removeItem(list, 'bolt').length, 1);
});

test('totalQuantity sums quantities', () => {
  const list = [{ name: 'bolt', quantity: 4 }, { name: 'nut', quantity: 6 }];
  assert.equal(totalQuantity(list), 10);
});

test('findItem returns null when the item is absent', () => {
  assert.equal(findItem([], 'ghost'), null);
});

test('itemNames returns a sorted list of names', () => {
  assert.deepEqual(itemNames([{ name: 'nut' }, { name: 'bolt' }]), ['bolt', 'nut']);
});
