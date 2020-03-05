'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var dep1 = require('./generated-dep1.js');
var dep2 = require('./generated-dep2.js');

const something = 'something';

console.log('main1', dep1.value1, dep2.value2, something);
new Promise(function (resolve) { resolve(require('./generated-dynamic.js')); });

exports.value1 = dep1.value1;
exports.value2 = dep2.value2;
