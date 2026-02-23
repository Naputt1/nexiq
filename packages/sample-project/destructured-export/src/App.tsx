import { useUser } from "./auth";

export const App = () => {
  const user = useUser();
  return <div>{user.role}</div>;
};
