var bundle = (function (exports, external) {
	'use strict';

	var external__default = 'default' in external ? external['default'] : external;



	Object.keys(external).forEach(function (k) {
		if (k !== 'default') Object.defineProperty(exports, k, {
			enumerable: true,
			get: function () {
				return external[k];
			}
		});
	});
	exports.default = external__default;

	return exports;

}({}, external));
