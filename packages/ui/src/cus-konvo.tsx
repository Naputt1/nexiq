import { useEffect, useState } from "react";
import Graph from "./graph/graph";

const CusKonvo = () => {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // keep stage size responsive
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="w-full h-full" style={{ width: "100vw", height: "100vh" }}>
      <Graph
        width={size.width}
        height={size.height}
        combos={[
          {
            id: "test",
            collapsed: false,
            label: { text: "Combo", fill: "white" },
          },
        ]}
      />
    </div>
  );
};

export default CusKonvo;
