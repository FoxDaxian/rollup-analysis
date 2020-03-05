System.register('iife', [], function (exports) {
  'use strict';
  return {
    execute: function () {

      exports({
        updateBar: update$1,
        updateBaz: update$2,
        updateFoo: update
      });

      function update () {
        foo = exports('foo', foo + 10);
      }

      let foo = exports('foo', 10);

      function update$1 () {
        (exports('bar', bar + 1), bar++);
      }

      let bar = exports('bar', 10);

      function update$2 () {
        exports('baz', ++baz);
      }

      let baz = exports('baz', 10);

      console.log(foo);
      update();
      console.log(foo);
      console.log(bar);
      update$1();
      console.log(bar);
      console.log(baz);
      update$2();
      console.log(baz);

    }
  };
});
