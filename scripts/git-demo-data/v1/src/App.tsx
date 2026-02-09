import React, { useState, useMemo, useEffect } from 'react';

export function App() {
  const [count, setCount] = useState(0);
  
  const doubledCount = useMemo(() => {
    return count * 2;
  }, [count]);

  useEffect(() => {
    console.log('App mounted or count changed:', count);
  }, [count]);

  return (
    <div>
      <h1>Main Application</h1>
      <Header />
      <Content count={count} doubledCount={doubledCount} onIncrement={() => setCount(c => c + 1)} />
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