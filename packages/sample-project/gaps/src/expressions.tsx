import { useState } from "react";

const a = 1;
const b = 2;
const c = 3;

const ternaryResult = a ? b : c;
const logicalResult = a && b;
const binaryResult = a + b;
const templateResult = `Hello ${a}`;
const unaryResult = !a;
const spreadArray = [...[a], b];
const seqResult = (a, b);
const tagged = String.raw`color: ${c};`;

export function App() {
  const [count] = useState(0);
  return (
    <div
      data={count || b}
      className={count > 0 ? "active" : ""}
      hidden={!count}
    >
      {binaryResult}
    </div>
  );
}
