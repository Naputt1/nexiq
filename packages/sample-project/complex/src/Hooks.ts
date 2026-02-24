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

export function useClickOutsideRef(ref: any, handler: any = () => {}) {
  useEffect(() => {
    const onMouseDown = (event: any) => {
      if (ref.current && !ref.current.contains(event.target)) {
        handler(event);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [ref, handler]);
}
