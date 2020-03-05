const assert = require('assert');

module.exports = {
	description: 'allows destructuring in exported variable declarations, synthetic or otherwise',
	buble: true,
	exports(exports) {
		assert.equal(exports.a, 1);
		assert.equal(exports.d, 4);
	}
};
