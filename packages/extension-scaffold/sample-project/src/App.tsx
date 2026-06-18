function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}!</h1>;
}

export function App() {
  return <Greeting name="nexiq" />;
}
