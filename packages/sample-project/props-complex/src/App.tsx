import React, { useEffect, useRef, useState } from "react";

interface Props {
  a: string;
  b: {
    x: number;
    y: number;
  };
  c: string;
}

const a = "a";

export const ComplexProps = ({
  a,
  b: { x, y: rename, ...restInner },
  defaultString = "default",
  defaultBool = false,
  defaultNumber = 0,
  defaultArray = [],
  defaultObject = { test: "test" },
  defaultRef = a,
  ...restOuter
}: any) => {
  const refX = useRef(x);
  const [stateX, setStateX] = useState(x);

  useEffect(() => {
    console.log(a);
  }, [a]);

  useEffect(() => {
    console.log(x);
  }, [x]);

  useEffect(() => {
    console.log(restInner);
  }, [restInner]);

  useEffect(() => {
    console.log(restOuter);
  }, [restOuter]);

  useEffect(() => {
    console.log(stateX);
  }, [stateX]);

  useEffect(() => {
    console.log(refX);
  }, [refX]);

  useEffect(() => {
    console.log(refX.current);
  }, [refX.current]);

  return (
    <div>
      {a} {x}
    </div>
  );
};
