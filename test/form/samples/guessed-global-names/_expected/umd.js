(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(require('unchanged'), require('changed'), require('special-character'), require('with/slash'), require('./relative.js')) :
	typeof define === 'function' && define.amd ? define(['unchanged', 'changed', 'special-character', 'with/slash', './relative.js'], factory) :
	(global = global || self, factory(global.unchanged, global.changedName, global.specialCharacter, global.slash, global.relative_js));
}(this, (function (unchanged, changedName, specialCharacter, slash, relative_js) { 'use strict';

	changedName = changedName && changedName.hasOwnProperty('default') ? changedName['default'] : changedName;

	console.log(unchanged.foo, changedName, specialCharacter.bar, slash.baz, relative_js.quux);

})));
