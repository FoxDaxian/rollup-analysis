(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('external')) :
	typeof define === 'function' && define.amd ? define(['exports', 'external'], factory) :
	(global = global || self, factory(global.foo = {}, global.external));
}(this, (function (exports, external) { 'use strict';

	exports.p = external.default;
	Object.defineProperty(exports, 'q', {
		enumerable: true,
		get: function () {
			return external.p;
		}
	});

	Object.defineProperty(exports, '__esModule', { value: true });

})));
