import React, { useMemo, useEffect, useReducer } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Content } from './Content';
import { useCounter } from './useCounter';
import { ThemeProvider } from './ThemeContext';

const initialState = { name: 'React Explorer', notifications: true };

function reducer(state: any, action: any) {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.payload };
    case 'TOGGLE_NOTIFICATIONS': return { ...state, notifications: !state.notifications };
    default: return state;
  }
}

export function App() {
  const { count, increment } = useCounter(0);
  const [state, dispatch] = useReducer(reducer, initialState);
  
  const doubledCount = useMemo(() => {
    return count * 2;
  }, [count]);

  useEffect(() => {
    console.log('App v4 mounted');
  }, []);

  return (
    <ThemeProvider>
      <div className="app-container">
        <Header />
        <h1>Welcome, {state.name}</h1>
        <div style={{ display: 'flex' }}>
          <Sidebar />
          <Content count={count} onIncrement={increment} version="4.0.0" />
        </div>
        <div style={{ marginTop: '20px' }}>
           <input 
             value={state.name} 
             onChange={(e) => dispatch({ type: 'SET_NAME', payload: e.target.value })} 
           />
           <label>
             <input 
               type="checkbox" 
               checked={state.notifications} 
               onChange={() => dispatch({ type: 'TOGGLE_NOTIFICATIONS' })}
             />
             Notifications
           </label>
        </div>
      </div>
    </ThemeProvider>
  );
}