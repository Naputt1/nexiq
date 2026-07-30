import { useState, lazy } from "react";
import React from "react";

interface User { name: string; }

const config = { theme: "dark" };
const alias = config.theme;
const maybeUser: User | null = { name: "Alice" };
const safe = { name: "Alice" } satisfies User;

const LazyOther = lazy(() => import("./Other"));

function save() { return "ok"; }

export class MyClass extends React.Component {
  constructor(public label: string) { super(); }
  render() { return <div>{this.label}</div>; }
}

export function App() {
  const [visible] = useState(true);
  const [obj] = useState({ nested: { value: 42 } });
  const r = save?.();
  return (
    <div
      optional={obj?.nested?.value}
      cast={alias as string}
      stamped={new Date()}
      forced={maybeUser!.name}
      hidden={!visible}
    />
  );
}
