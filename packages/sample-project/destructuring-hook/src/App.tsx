import { useState, useContext, createContext, useEffect } from "react";

const MyContext = createContext({ theme: "light" });

function useTranslation() {
  return { t: (key: string) => key };
}

function useQuery() {
  return {
    data: { user: { name: "John", settings: { theme: "dark" } } },
    isLoading: false,
    error: null,
  };
}

export const App = () => {
  const { t } = useTranslation();
  const { theme } = useContext(MyContext);
  const {
    data: {
      user: {
        name,
        settings: { theme: userTheme },
      },
    },
    isLoading,
    error,
  } = useQuery();

  useEffect(() => {
    console.log(name);
  }, [userTheme]);

  return (
    <div>
      <h1>{t("welcome")}</h1>
      <p>Theme: {theme}</p>
      <p>User: {name}</p>
      <p>User Theme: {userTheme}</p>
      {isLoading && <p>Loading...</p>}
      {error && <p>Error</p>}
      <Child data={name} />
      <Other loading={isLoading} />
    </div>
  );
};

const Child = ({ data }: { data: string }) => <div>{data}</div>;
const Other = ({ loading }: { loading: boolean }) => (
  <div>{loading ? "Loading..." : "Done"}</div>
);
