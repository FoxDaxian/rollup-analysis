const path = require('path');
const fs = require('fs');
const assert = require('assert');

const cachedModules = {
	'@main.js': 'import foo from "./foo"; export default foo();'
};

module.exports = {
	description: 'applies custom resolver to entry point',
	options: {
		plugins: [
			{
				resolveId(importee, importer) {
					if (importer === undefined) {
						return '@' + path.relative(__dirname, importee);
					}

					if (importer[0] === '@') {
						return path.resolve(__dirname, importee) + '.js';
					}
				},
				load(moduleId) {
					if (moduleId[0] === '@') {
						return cachedModules[moduleId];
					}

					return fs.readFileSync(moduleId, 'utf-8');
				}
			}
		]
	},
	exports(exports) {
		assert.equal(exports, 42);
	}
};
