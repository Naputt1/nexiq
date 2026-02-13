import { useState, useContext, createContext } from "react";

const MyContext = createContext({ theme: 'dark' });

const useTranslation = () => ({ t: (s: string) => s });

export function App() {
  const { t } = useTranslation();
  const { theme } = useContext(MyContext);

  return <div>{t('hello')} {theme}</div>;
}
