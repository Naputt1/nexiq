import React from 'react';
import MainNested, { AliasedA } from './ReExport';
import { MyProvider, MyConsumer } from './Context';
import { useCustomHook } from './Hooks';
import { MemoizedComponent, ForwardRefComponent, WrappedComponent } from './HocForwardRef';
import { DestructuringProps } from './Destructuring';

export function ComplexApp() {
  const [val, setVal] = useCustomHook(10);

  return (
    <MyProvider>
      <MainNested />
      <AliasedA />
      <MyConsumer />
      <MemoizedComponent name="World" />
      <ForwardRefComponent label="Click me" />
      <WrappedComponent />
      <DestructuringProps title="Test" items={['a', 'b']} />
      <button onClick={() => setVal(val + 1)}>Increment {val}</button>
    </MyProvider>
  );
}
