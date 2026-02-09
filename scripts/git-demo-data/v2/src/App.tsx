import React, { useMemo, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { useCounter } from './useCounter';

export function App() {
  const { count, increment } = useCounter(0);
  
  const doubledCount = useMemo(() => {
    return count * 2;
  }, [count]);

  useEffect(() => {
    console.log('App v2 count changed:', count);
  }, [count]);

  return (
    <div>
      <h1>Main Application v2</h1>
      <Header />
      <div style={{ display: 'flex' }}>
        <Sidebar />
        <Content count={count} doubledCount={doubledCount} onIncrement={increment} />
      </div>
      <Footer />
    </div>
  );
}

function Header() {
  return <header>Header v1</header>;
}

function Content({ count, doubledCount, onIncrement }: any) {
  return (
    <main>
      <p>Count: {count}</p>
      <p>Doubled: {doubledCount}</p>
      <button onClick={onIncrement}>Increment</button>
    </main>
  );
}

function Footer() {
  return <footer>Footer</footer>;
}