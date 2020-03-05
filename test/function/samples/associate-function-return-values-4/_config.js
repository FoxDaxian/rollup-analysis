const assert = require('assert');

module.exports = {
	description: 'Handles empty return statements (#1702)',
	exports(exports) {
		assert.equal(exports.bar, 'present');
	}
};
