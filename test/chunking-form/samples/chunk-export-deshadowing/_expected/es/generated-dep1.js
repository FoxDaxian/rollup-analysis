function fn () {
  console.log('lib fn');
}

function fn$1 () {
  fn();
  console.log(text$1);
}

var text = 'dep1 fn';

function fn$2 () {
  console.log(text);
}

var text$1 = 'dep2 fn';

export { fn$1 as a, fn$2 as f };
