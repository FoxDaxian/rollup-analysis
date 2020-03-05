System.register(['./generated-dep2.js'], function (exports) {
  'use strict';
  var fn$2;
  return {
    setters: [function (module) {
      fn$2 = module.f;
    }],
    execute: function () {

      function fn () {
        console.log('lib1 fn');
      }

      function fn$1 () {
        fn();
        console.log('dep3 fn');
      }

      class Main2 {
        constructor () {
          fn$1();
          fn$2();
        }
      } exports('default', Main2);

    }
  };
});
