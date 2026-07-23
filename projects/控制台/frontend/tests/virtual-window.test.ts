import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateVirtualWindow } from '../src/lib/virtualWindow.js';

test('a 1000-row list renders only the visible window and overscan', () => {
  const window = calculateVirtualWindow({
    count: 1000,
    scrollTop: 250 * 400,
    viewportHeight: 800,
    rowHeight: 250,
    overscan: 5,
  });
  assert.equal(window.totalHeight, 250000);
  assert.equal(window.start, 395);
  assert.equal(window.end, 409);
  assert.equal(window.end - window.start, 14);
});

test('virtual window clamps negative and end-of-list positions', () => {
  const top = calculateVirtualWindow({
    count: 100,
    scrollTop: -100,
    viewportHeight: 500,
    rowHeight: 100,
    overscan: 3,
  });
  assert.equal(top.start, 0);
  assert.equal(top.end, 8);

  const bottom = calculateVirtualWindow({
    count: 100,
    scrollTop: 999999,
    viewportHeight: 500,
    rowHeight: 100,
    overscan: 3,
  });
  assert.equal(bottom.end, 100);
});
