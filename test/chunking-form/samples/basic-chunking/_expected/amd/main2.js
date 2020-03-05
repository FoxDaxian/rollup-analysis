define(['./generated-dep2'], function (dep2) { 'use strict';

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
      dep2.fn();
    }
  }

  return Main2;

});
