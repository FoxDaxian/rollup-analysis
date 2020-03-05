define(['require', 'exports', 'external1', 'external2'], function (require, exports, external1, external2) { 'use strict';

	function _interopNamespace(e) {
		if (e && e.__esModule) { return e; } else {
			var n = {};
			if (e) {
				Object.keys(e).forEach(function (k) {
					n[k] =e [k];
				});
			}
			n['default'] = e;
			return n;
		}
	}

	const dynamic = new Promise(function (resolve, reject) { require(['external3'], function (m) { resolve(_interopNamespace(m)); }, reject) });

	Object.keys(external2).forEach(function (k) {
		if (k !== 'default') exports[k] = external2[k];
	});
	exports.external1 = external1.external1;
	exports.dynamic = dynamic;

	Object.defineProperty(exports, '__esModule', { value: true });

});
