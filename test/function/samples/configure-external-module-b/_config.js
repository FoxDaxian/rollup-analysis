const assert = require('assert');

module.exports = {
	description: 'allows external module to be configured (b)',
	options: {
		external: ['path']
	},
	exports() {
		assert.equal(require('path').resolve.configured, 'yes');
	}
};
