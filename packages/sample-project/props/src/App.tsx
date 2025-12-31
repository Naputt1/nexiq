import { DestructuringProps } from "./Destructuring";
import { TypePropsFunction, TypePropsVar, TypePropsVarInline } from "./type";

export function App() {
  return (
    <div>
      <DestructuringProps title="World" items={["a", "b"]} />
    </div>
  );
}
