import React, { useMemo, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useCounter } from './useCounter';
import { ThemeProvider } from './ThemeContext';

export function App() {
  const { count, increment } = useCounter(0);
  
  const tripleCount = useMemo(() => {
    return count * 3;
  }, [count]);

  useEffect(() => {
    console.log('App v3 count changed:', count);
  }, [count]);

  return (
    <ThemeProvider>
      <div>
        <h1>Main Application v3</h1>
        <Header />
        <div style={{ display: 'flex' }}>
          <Sidebar />
          <Content count={count} tripleCount={tripleCount} onIncrement={increment} />
        </div>
        {/* Footer deleted in v3 */}
      </div>
    </ThemeProvider>
  );
}

function Content({ count, tripleCount, onIncrement }: any) {
  return (
    <main>
      <p>Count: {count}</p>
      <p>Triple: {tripleCount}</p>
      <button onClick={onIncrement}>Increment</button>
    </main>
  );
}
