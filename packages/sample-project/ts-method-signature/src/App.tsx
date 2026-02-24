import React from 'react';

export interface MyInterface {
  myMethod(a: string, b?: number): void;
  anotherMethod<T>(x: T): T;
}

export type MyType = {
  inlineMethod(p: boolean): string;
};

export const App = () => {
  return <div>Test</div>;
};
