import React, { createContext, useContext } from 'react';

export const MyContext = createContext<{ theme: string }>({ theme: 'light' });

export const MyProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <MyContext.Provider value={{ theme: 'dark' }}>
      {children}
    </MyContext.Provider>
  );
};

export const MyConsumer = () => {
  const context = useContext(MyContext);
  return <div>Theme: {context.theme}</div>;
};
