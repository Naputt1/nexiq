import React from "react";

export class NestedRender extends React.Component {
  private renderHeader() {
    return (
      <header>
        <h1>Nested Header</h1>
      </header>
    );
  }

  private renderItem(item: string) {
    return <li key={item}>{item}</li>;
  }

  render() {
    const items = ["A", "B", "C"];
    return (
      <div className="nested-render">
        {this.renderHeader()}
        <ul>{items.map((item) => this.renderItem(item))}</ul>
      </div>
    );
  }
}
