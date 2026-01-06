import { useEffect, useState } from "react";

const Effect = () => {
  const [state, setState] = useState(0);

  useEffect(() => {
    setState((i) => i + 1);
  }, [state]);

  return <div></div>;
};
