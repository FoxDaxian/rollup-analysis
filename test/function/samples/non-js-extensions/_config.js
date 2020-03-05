const path = require('path');

module.exports = {
	description: 'non .js extensions are preserved',
	options: {
		plugins: [
			{
				transform(code, id) {
					if (path.extname(id) === '.json') {
						return 'export default ' + code;
					}
				}
			}
		]
	}
};
