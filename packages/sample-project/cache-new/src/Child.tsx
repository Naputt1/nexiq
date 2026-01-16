import { useEffect, useState } from "react";

export function Child({ user }: { user: { name: string } }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log("Child", user.name);
  }, [count]);

  return (
    <div>
      {user.name} -{count}
      <button onClick={() => setCount((count) => count + 1)}>
        count is {count}
      </button>
    </div>
  );
}
