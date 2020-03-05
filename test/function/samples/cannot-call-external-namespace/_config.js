const path = require('path');

module.exports = {
	description: 'errors if code calls an external namespace',
	error: {
		code: 'CANNOT_CALL_NAMESPACE',
		message: `Cannot call a namespace ('foo')`,
		pos: 28,
		watchFiles: [path.resolve(__dirname, 'main.js')],
		loc: {
			file: path.resolve(__dirname, 'main.js'),
			line: 2,
			column: 0
		},
		frame: `
			1: import * as foo from 'foo';
			2: foo();
			   ^
		`
	}
};
