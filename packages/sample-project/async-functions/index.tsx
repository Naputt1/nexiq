import React, { useMemo, useCallback } from 'react';

// Async Component (Server Component style or just async)
export async function AsyncComponent() {
  return <div>Async Component</div>;
}

// Async Hook
export async function useAsyncHook() {
  return await Promise.resolve(42);
}

// Async Function Variable
export const asyncFn = async () => {
  return "hello";
};

export const App = () => {
  // useCallback with async
  const handleAsync = useCallback(async () => {
    await Promise.resolve();
  }, []);

  // useMemo with async (returning a promise)
  const asyncValue = useMemo(async () => {
    return await Promise.resolve("memo");
  }, []);

  // Local async function
  async function localAsync() {
    return 1;
  }

  return (
    <div>
      <AsyncComponent />
    </div>
  );
};
