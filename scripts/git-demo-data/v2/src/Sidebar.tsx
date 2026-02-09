import React, { useRef, useState } from 'react';

export function Sidebar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');

  const handleFocus = () => {
    inputRef.current?.focus();
  };

  return (
    <aside>
      <h3>Sidebar v2</h3>
      <input 
        ref={inputRef} 
        value={name} 
        onChange={(e) => setName(e.target.value)} 
        placeholder="Enter name"
      />
      <button onClick={handleFocus}>Focus Input</button>
      <p>Hello, {name || 'Guest'}</p>
    </aside>
  );
}