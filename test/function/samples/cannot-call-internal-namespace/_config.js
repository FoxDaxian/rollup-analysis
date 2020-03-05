const path = require('path');

module.exports = {
	description: 'errors if code calls an internal namespace',
	error: {
		code: 'CANNOT_CALL_NAMESPACE',
		message: `Cannot call a namespace ('foo')`,
		pos: 33,
		watchFiles: [path.resolve(__dirname, 'main.js'), path.resolve(__dirname, 'foo.js')],
		loc: {
			file: path.resolve(__dirname, 'main.js'),
			line: 2,
			column: 0
		},
		frame: `
			1: import * as foo from './foo.js';
			2: foo();
			   ^
		`
	}
};
