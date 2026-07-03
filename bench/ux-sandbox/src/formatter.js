const { add } = require('./mathUtils');

// Sum a list of numbers using the shared add() utility.
function sum(list) {
  return list.reduce((acc, n) => add(acc, n), 0);
}

module.exports = { sum };
