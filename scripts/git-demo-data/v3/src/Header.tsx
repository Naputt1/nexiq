import React from 'react';
import { useTheme } from './ThemeContext';

export function Header() {
  const { theme, toggle } = useTheme();
  
  return (
    <header style={{ background: theme === 'dark' ? '#333' : '#eee', color: theme === 'dark' ? 'white' : 'black' }}>
      <h2>Header v3</h2>
      <button onClick={toggle}>Toggle Theme</button>
    </header>
  );
}