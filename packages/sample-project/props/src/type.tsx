import React from "react";
import { Child4, Test3 } from "./type2";

type stringAlias = string;

type Test =
  | ({
      title?: string;
      items: string[];
    } & {
      title: string;
    })
  | {
      title: string;
    }
  | Test3
  | Child4;

type Props<T extends Child = any> = {
  title: string;
  items: string[];
  test: T;
};

interface Child {
  title: string;
  items?: string[];
}

const Test65 = {
  title: "test",
};

interface Parent<T extends Child = any, TStr extends string = any>
  extends Child {
  title: string;
  i: number;
  items?: string[];
  items2?: Record<string, string>[];
  test: { [key: string]: string };
  test2: Record<string, string>;
  test3: T;
  test4: {
    test5: string;
  };
  t: true;
  f: false;
  te: "test";
  union: "test" | "test2";
  intersection: "test" & "test2";
  bigint: 10n;
  template: `foo-${string}`;
  template2: `foo-${TStr}`;
  unary: -1;
  unary2: -1 | -2 | -10;
  object: Object;
  c: (
    x: number,
    {
      a,
      b,
      c: {
        d: { e },
      },
      ...res
    }: { a: string; b: boolean; c: { d: { e: number } }; f: number },
    [y, z, { t }, ...arrRest]: [number, o: number, { t: number }, number],
    ...rest: unknown[]
  ) => void;
  cb: () => void;
  cb2: (a: string, b: number) => void;
  cb3: (a: string, b: number) => number;
  cb4: <T extends Child = any>(a: T, b?: number) => number;
}

export const TypePropsVar: React.FC<Test> = ({ title }) => {
  return <div></div>;
};

export const TypePropsVarFunction: React.FC<Parent> = function ({
  title,
  items,
}) {
  return <div></div>;
};

export const TypePropsVarInline = ({ title, items }: Child) => {
  return <div></div>;
};

export const TypePropsVarInlineFunction = function ({ title, items }: Props) {
  return (
    <div>
      <h1>{title}</h1>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
};

export function TypePropsFunction({ title, items }: Props) {
  return (
    <div>
      <h1>{title}</h1>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
