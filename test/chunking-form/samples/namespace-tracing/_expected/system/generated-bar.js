System.register(['./generated-broken.js'], function (exports) {
  'use strict';
  return {
    setters: [function () {}],
    execute: function () {

      exports('b', bar);

      function bar() {
        console.log('bar');
      }

    }
  };
});
