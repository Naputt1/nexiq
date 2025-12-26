import React from 'react';

export const SubComponentA = () => <div>Sub A</div>;

export function SubComponentB() {
  return (
    <div>
      <SubComponentA />
      Sub B
    </div>
  );
}

const InternalComponent = () => <span>Internal</span>;

export default function MainNested() {
  return (
    <section>
      <SubComponentB />
      <InternalComponent />
    </section>
  );
}
