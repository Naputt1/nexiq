import { useState, useEffect } from 'react';

export function useCounter(initialValue = 0) {
  const [count, setCount] = useState(initialValue);

  useEffect(() => {
    const timer = setInterval(() => {
      // Auto increment for demo
      // setCount(c => c + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const increment = () => setCount(c => c + 1);
  const decrement = () => setCount(c => c - 1);

  return { count, increment, decrement };
}
