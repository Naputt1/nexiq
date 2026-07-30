import React from "react";

interface Base<T> { value: T; }
interface Concrete extends Base<string> { extra: number; }

interface AppProps {
  name: string;
  count: number;
}

const List = <T extends { id: string }>(props: { items: T[] }) => {
  return <div>{props.items.length}</div>;
};

export class App extends React.Component<AppProps> {
  accessor data = 0;
  render() {
    return (
      <div>
        {this.props.name}: {this.props.count}
        <List items={[{ id: "1" }]} />
      </div>
    );
  }
}
