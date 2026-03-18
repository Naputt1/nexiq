import React, { useEffect, useState } from "react";

export default function CardBody(props: {
  expanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanding, setExpanding] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanding(true);
    if (props.expanded) {
      setExpanded(true);
    }
  }, [props.expanded]);

  return (
    <div>
      {expanded ? "Expanded" : "Collapsed"}
      {props.children}
    </div>
  );
}
