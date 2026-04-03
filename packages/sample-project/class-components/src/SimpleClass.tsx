import React from "react";

interface Props {
  initialCount?: number;
}

interface State {
  count: number;
}

export class SimpleClass extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      count: props.initialCount || 0,
    };
  }

  increment = () => {
    this.setState((state) => ({ count: state.count + 1 }));
  };

  render() {
    return (
      <div className="simple-class">
        <p>Count: {this.state.count}</p>
        <button onClick={this.increment}>Increment</button>
      </div>
    );
  }
}
