import { useState, useContext, createContext } from "react";
import { Child } from "./Child";
import { Other } from "./Other";

const MyContext = createContext({ theme: 'dark' });

const useTranslation = () => ({ t: (s: string) => s });
const useQuery = () => ({ data: 'foo', isLoading: false, error: null });

export function App() {
  const { t } = useTranslation();
  const { theme } = useContext(MyContext);
  const { data, isLoading, error } = useQuery();

  return (
    <div>
      {t('hello')} {theme} 
      <Other loading={isLoading} />
      <Child data={data} />
    </div>
  );
}
