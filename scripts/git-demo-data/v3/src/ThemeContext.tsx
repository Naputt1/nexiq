import React, { createContext, useContext, useState } from 'react';

const ThemeContext = createContext<{ theme: string; toggle: () => void }>({ 
  theme: 'light', 
  toggle: () => {} 
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState('light');
  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
