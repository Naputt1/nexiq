import { useState } from "react";

const config = { theme: "dark" };
const alias = config.theme;

export function App() {
  const [obj] = useState({ nested: { value: 42 } });
  return (
    <div
      optional={obj?.nested?.value}
      cast={alias as string}
      stamped={new Date()}
    />
  );
}
