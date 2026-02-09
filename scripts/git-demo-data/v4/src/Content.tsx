import React, { useCallback } from 'react';
import { useTheme } from './ThemeContext';

export function Content({ count, doubledCount, onIncrement }: any) {
  const { theme } = useTheme();

  const handleClick = useCallback(() => {
    console.log('Incrementing from Content...');
    onIncrement();
  }, [onIncrement]);

  return (
    <main style={{ padding: '20px', border: theme === 'dark' ? '1px solid white' : '1px solid black' }}>
      <p>Count: {count}</p>
      <p>Doubled: {doubledCount}</p>
      <button onClick={handleClick}>Increment</button>
    </main>
  );
}