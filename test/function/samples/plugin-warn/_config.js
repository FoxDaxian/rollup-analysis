const path = require('path');

module.exports = {
	description: 'plugin transform hooks can use `this.warn({...}, char)` (#1140)',
	options: {
		plugins: [
			{
				name: 'test',
				transform(code, id) {
					this.warn({ message: 'foo' });
					this.warn('bar', 22);
					return 'assert.equal( 21 * 2, 42 );';
				}
			}
		]
	},
	warnings: [
		{
			code: 'PLUGIN_WARNING',
			id: path.resolve(__dirname, 'main.js'),
			hook: 'transform',
			plugin: 'test',
			message: 'foo'
		},
		{
			code: 'PLUGIN_WARNING',
			id: path.resolve(__dirname, 'main.js'),
			plugin: 'test',
			hook: 'transform',
			message: 'bar',
			pos: 22,
			loc: {
				file: path.resolve(__dirname, 'main.js'),
				line: 1,
				column: 22
			},
			frame: `
				1: assert.equal( 21 * 2, TK );
				                         ^
			`
		}
	]
};
