import React from "react";

export class ArrowRender extends React.Component {
  state = { text: "Hello from Arrow" };

  render = () => {
    return (
      <div className="arrow-render">
        <p>{this.state.text}</p>
        <span>Arrow function render works too!</span>
      </div>
    );
  };
}
