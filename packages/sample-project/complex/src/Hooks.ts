import { useState, useEffect, useMemo } from "react";

export function useCustomHook(initialValue: number) {
  const [value, setValue] = useState(initialValue);

  const memoVal = useMemo(() => value * 2, [value]);

  useEffect(() => {
    console.log("Value changed:", value);
    console.log("Memo value changed:", memoVal);
  }, [value, memoVal]);

  return [value, setValue] as const;
}

export const useOtherHook = () => {
  return "constant";
};
