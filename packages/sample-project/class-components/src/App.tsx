import { SimpleClass } from "./SimpleClass";
import { StaticComponents } from "./StaticComponents";
import { NestedRender } from "./NestedRender";
import { ArrowRender } from "./ArrowRender";

function App() {
  return (
    <div className="app">
      <h1>Class Component Edge Cases</h1>
      <SimpleClass initialCount={10} />
      <hr />
      <StaticComponents title="Modal Title">
        <p>Internal Content</p>
      </StaticComponents>
      <hr />
      <NestedRender />
      <hr />
      <ArrowRender />
    </div>
  );
}

export default App;
