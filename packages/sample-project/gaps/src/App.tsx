import { useState } from "react";

const config = { theme: "dark" };
const alias = config.theme;

interface User { name: string; }
const maybeUser: User | null = { name: "Alice" };

export function App() {
  const [obj] = useState({ nested: { value: 42 } });
  return (
    <div
      optional={obj?.nested?.value}
      cast={alias as string}
      stamped={new Date()}
      forced={maybeUser!.name}
    />
  );
}
