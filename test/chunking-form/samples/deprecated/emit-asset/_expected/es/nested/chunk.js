var logo = new URL('../assets/logo1-a5ec488b.svg', import.meta.url).href;

function showImage(url) {
	console.log(url);
	if (typeof document !== 'undefined') {
		const image = document.createElement('img');
		image.src = url;
		document.body.appendChild(image);
	}
}

showImage(logo);
import('./chunk2.js');

export { showImage as s };
