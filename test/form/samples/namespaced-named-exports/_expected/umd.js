(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = global || self, factory((global.foo = global.foo || {}, global.foo.bar = global.foo.bar || {}, global.foo.bar.baz = {})));
}(this, (function (exports) { 'use strict';

	var answer = 42;

	exports.answer = answer;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
