import { useEffect, useState } from "react";
import { useCustomHook } from "./Hooks";

const Effect = () => {
  const [state, setState] = useState(0);
  const [state2, setState2] = useCustomHook(0);

  useEffect(() => {
    setState((i) => i + 1);
  }, [state]);

  useEffect(() => {
    setState2((i) => i + 1);
  }, [state2]);

  return <div></div>;
};
