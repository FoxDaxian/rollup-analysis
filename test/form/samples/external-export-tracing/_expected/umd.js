(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('external')) :
	typeof define === 'function' && define.amd ? define(['exports', 'external'], factory) :
	(global = global || self, factory(global.myBundle = {}, global.external));
}(this, (function (exports, external) { 'use strict';

	Object.defineProperty(exports, 's', {
		enumerable: true,
		get: function () {
			return external.p;
		}
	});

	Object.defineProperty(exports, '__esModule', { value: true });

})));
