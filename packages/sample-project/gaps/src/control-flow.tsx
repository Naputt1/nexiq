import React from "react";

export function App() {
  let i = 0;

  if (i > 0) {
    const x = "in if";
    console.log(x);
  } else {
    const y = "in else";
    console.log(y);
  }

  while (i < 3) {
    i++;
  }

  do {
    i--;
  } while (i > 0);

  try {
    throw new Error("fail");
  } catch (e) {
    console.log(e.message);
  }

  return <div>done</div>;
}

export class WithStatic extends React.Component {
  static counter = 0;
  static {
    WithStatic.counter = 42;
  }
  render() {
    return <div>{WithStatic.counter}</div>;
  }
}
