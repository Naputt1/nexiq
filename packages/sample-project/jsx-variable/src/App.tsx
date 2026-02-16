import React from "react";

const Child = ({ prop }: { prop: any }) => <div>{prop}</div>;
const Child2 = ({ children, prop }: { children: any; prop: any }) => (
  <div {...prop}>{children}</div>
);

export const App = () => {
  const x = 1;
  let y = 2;
  var z = 3;
  const v = <Child prop={x} />;

  const CustomForm = ({ children }: any) => <form>{children}</form>;
  const form = (
    <CustomForm>
      <input type="text" />
    </CustomForm>
  );

  return (
    <div className={`app-${x}`}>
      <div className="nested-1">
        <div className={`nested-2-${y}`}>
          {v}
          {form}
        </div>
      </div>
      <Child2 prop={y}>
        <>
          <span className={x > 0 ? "active" : ""}>{x + y}</span>
        </>
      </Child2>
    </div>
  );
};
