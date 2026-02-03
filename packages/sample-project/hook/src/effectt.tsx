import { useEffect, useMemo, useState } from "react";
import { useCustomHook } from "./Hooks";

const Effect = () => {
  const [state, setState] = useState(0);
  const [state2, setState2] = useCustomHook(0);

  const memoVal = useMemo(() => state * 2, [state]);

  useEffect(() => {
    setState((i) => i + 1);
  }, [state, memoVal]);

  useEffect(() => {
    setState2((i) => i + 1);
  }, [state2]);

  return <div></div>;
};
