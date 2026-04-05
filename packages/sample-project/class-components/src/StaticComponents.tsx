import React from "react";

const Header = ({ title }: { title: string }) => <h3>{title}</h3>;
const Body = ({ children }: { children: React.ReactNode }) => (
  <div className="modal-body">{children}</div>
);
const Footer = () => <footer>Modal Footer</footer>;

export class StaticComponents extends React.Component<{
  title: string;
  children: React.ReactNode;
}> {
  static Header = Header;
  static Body = Body;
  static Footer = Footer;

  render() {
    return (
      <div className="modal">
        <StaticComponents.Header title={this.props.title} />
        <StaticComponents.Body>{this.props.children}</StaticComponents.Body>
        <StaticComponents.Footer />
      </div>
    );
  }
}
