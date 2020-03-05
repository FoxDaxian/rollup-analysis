'use strict';

var logo = (typeof document === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __dirname + '/../assets/logo1-a5ec488b.svg').href : new URL('../assets/logo1-a5ec488b.svg', document.currentScript && document.currentScript.src || document.baseURI).href);

function showImage(url) {
	console.log(url);
	if (typeof document !== 'undefined') {
		const image = document.createElement('img');
		image.src = url;
		document.body.appendChild(image);
	}
}

showImage(logo);
new Promise(function (resolve) { resolve(require('./chunk2.js')); });

exports.showImage = showImage;
