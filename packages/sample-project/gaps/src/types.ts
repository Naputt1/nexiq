interface User { name: string; age: number; }

type A = object;
type B = symbol;
type C = this;

type UserKeys = keyof User;
type Factory = new (name: string) => User;
type IsString<T> = T extends string ? true : false;
type Optional<T> = { [K in keyof T]?: T[K] };
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
type EventName = `on${string}`;
type Intrinsic = intrinsic;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function App() {
  return <div>ok</div>;
}
