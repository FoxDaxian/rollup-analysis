define(['exports', 'starexternal2', 'external2', './generated-dep'], function (exports, starexternal2, external2, dep) { 'use strict';

	var main = '2';

	Object.keys(starexternal2).forEach(function (k) {
		if (k !== 'default') Object.defineProperty(exports, k, {
			enumerable: true,
			get: function () {
				return starexternal2[k];
			}
		});
	});
	Object.defineProperty(exports, 'e', {
		enumerable: true,
		get: function () {
			return external2.e;
		}
	});
	exports.dep = dep.dep;
	exports.main = main;

	Object.defineProperty(exports, '__esModule', { value: true });

});
