System.register([], function (exports) {
	'use strict';
	return {
		execute: function () {

			console.log('dep');

			const dep = exports('a', 'dep');

			console.log('dynamic', dep);
			const dynamic = exports('d', 'dynamic');

		}
	};
});
