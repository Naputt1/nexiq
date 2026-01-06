import { useState, useEffect } from "react";

export function useCustomHook(initialValue: number) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    console.log("Value changed:", value);
  }, [value]);

  return [value, setValue] as const;
}

export const useOtherHook = () => {
  return "constant";
};
