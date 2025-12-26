import React from 'react';
import { SubComponentA as A } from './Nested';

export const DestructuringProps = ({ title, items }: { title: string, items: string[] }) => {
  return (
    <div>
      <h1>{title}</h1>
      <ul>
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
      <A />
    </div>
  );
};
