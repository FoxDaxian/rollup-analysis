System.register(['./generated-dynamic2.js'], function (exports) {
	'use strict';
	return {
		setters: [function (module) {
			var _setter = {};
			_setter.DYNAMIC_A = module.DYNAMIC_B;
			_setter.DYNAMIC_B = module.DYNAMIC_A;
			exports(_setter);
		}],
		execute: function () {



		}
	};
});
