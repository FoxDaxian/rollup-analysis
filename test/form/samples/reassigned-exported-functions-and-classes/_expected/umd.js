(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = global || self, factory(global.bundle = {}));
}(this, (function (exports) { 'use strict';

	function foo () {}
	foo = 1;

	class bar {}
	bar = 1;

	exports.bar = bar;
	exports.foo = foo;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
