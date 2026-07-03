const { add, subtract, multiply } = require('./mathUtils');

// A small chainable calculator built on the math utilities.
class Calculator {
  constructor() {
    this.value = 0;
  }

  plus(n) {
    this.value = add(this.value, n);
    return this;
  }

  minusBy(n) {
    this.value = subtract(this.value, n);
    return this;
  }

  times(n) {
    this.value = multiply(this.value, n);
    return this;
  }

  result() {
    return this.value;
  }
}

module.exports = { Calculator };
