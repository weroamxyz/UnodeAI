const test = require('node:test');
const assert = require('node:assert');
const { add, subtract, multiply } = require('../src/mathUtils');
const { Calculator } = require('../src/calculator');
const { sum } = require('../src/formatter');

test('add', () => {
  assert.strictEqual(add(2, 3), 5);
});

test('subtract', () => {
  assert.strictEqual(subtract(5, 2), 3);
});

test('multiply', () => {
  assert.strictEqual(multiply(4, 3), 12);
});

test('calculator chain', () => {
  const c = new Calculator();
  assert.strictEqual(c.plus(10).minusBy(4).times(2).result(), 12);
});

test('sum', () => {
  assert.strictEqual(sum([1, 2, 3, 4]), 10);
});
