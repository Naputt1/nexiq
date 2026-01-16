import React, { useState } from "react";

export function Child({ user }: { user: { name: string } }) {
  // const [count, setCount] = useState(0);
  return (
    <div>
      {user.name} -{/* {count} */}
    </div>
  );
}
