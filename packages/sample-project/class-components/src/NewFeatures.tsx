import React from "react";

export class NewFeatures extends React.Component {
  myRef = React.createRef();

  componentDidMount() {
    console.log("Mounted", this.props.title);
  }

  componentDidUpdate(prevProps) {
    if (this.props.count !== prevProps.count) {
      console.log("Count changed");
    }
  }

  render() {
    const { user, age = 20 } = this.props as any;
    return (
      <div ref={this.myRef}>
        <h1>{user.name}</h1>
        <p>Age: {age}</p>
        <p>Title: {this.props.title}</p>
      </div>
    );
  }
}
