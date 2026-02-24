import React, { useState, useEffect } from "react";
import { useMemo as myMemo } from "react";
import * as ReactNamespace from "react";
import R from "react";

export const MyComponent = () => {
  const [s1, setS1] = useState(0);
  const [s2, setS2] = React.useState(0);
  const m1 = myMemo(() => 0, []);
  const [s3, setS3] = ReactNamespace.useState(0);
  const [s4, setS4] = R.useState(0);

  useEffect(() => {
    console.log(s1);
  }, [s1]);

  React.useEffect(() => {
    console.log(s2);
  }, [s2]);

  // This should NOT be detected as a React state because it's not from 'react'
  const notReact = {
    useState: (val: number): [number, () => void] => [val, () => {}],
    useEffect: (fn: any, deps: any) => {},
  };
  const [s5, setS5] = notReact.useState(0);

  notReact.useEffect(() => {
    console.log(s5);
  }, [s5]);

  // Custom hook (should still be detected as a hook, but not a React state)
  const [s6, setS6] = useFakeHook(0);

  return (
    <div>
      {s1} {s2} {m1} {s3} {s4} {s5} {s6}
    </div>
  );
};

function useFakeHook(val: number): [number, () => void] {
  return [val, () => {}];
}
