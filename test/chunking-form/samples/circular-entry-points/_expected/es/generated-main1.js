class C {
  fn (num) {
    console.log(num - p$1);
  }
}

var p = 43;

new C().fn(p);

class C$1 {
  fn (num) {
    console.log(num - p);
  }
}

var p$1 = 42;

new C$1().fn(p$1);

export { p$1 as a, p };
