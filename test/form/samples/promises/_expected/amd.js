define(['exports'], function (exports) { 'use strict';

	const p1 = new Promise( () => {
		console.log( 'fire & forget' );
	} );

	const p2 = new Promise( () => {
		console.info( 'forget me as well' );
	} );

	const p3 = new Promise( () => {
		console.info( 'and me too' );
	} );
	const p5 = Promise.reject('should be kept for uncaught rejections');
	const allExported = Promise.all([p2, p3]);

	exports.allExported = allExported;

	Object.defineProperty(exports, '__esModule', { value: true });

});
