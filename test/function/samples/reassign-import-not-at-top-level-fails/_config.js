const path = require('path');

module.exports = {
	description: 'disallows assignments to imported bindings not at the top level',
	error: {
		code: 'ILLEGAL_REASSIGNMENT',
		message: `Illegal reassignment to import 'x'`,
		pos: 95,
		watchFiles: [path.resolve(__dirname, 'main.js'), path.resolve(__dirname, 'foo.js')],
		loc: {
			file: path.resolve(__dirname, 'main.js'),
			line: 7,
			column: 2
		},
		frame: `
			5: }
			6: export function bar () {
			7:   x = 1;
			     ^
			8: }
		`
	}
};

// test copied from https://github.com/esnext/es6-module-transpiler/tree/master/test/examples/reassign-import-fails
