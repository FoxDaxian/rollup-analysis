'use strict';

var asset1 = 'chunkId=cjs.js:moduleId=solved:fileName=assets/asset-solved-28a7ac89.txt:format=cjs:relativePath=assets/asset-solved-28a7ac89.txt:referenceId=6296c678';

var asset2 = 'resolved';

var asset3 = (typeof document === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __dirname + '/assets/asset-unresolved-8dcd7fca.txt').href : new URL('assets/asset-unresolved-8dcd7fca.txt', document.currentScript && document.currentScript.src || document.baseURI).href);

console.log(asset1, asset2, asset3);
