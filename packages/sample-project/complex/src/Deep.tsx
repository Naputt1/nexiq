import React, { useState, useEffect } from 'react';

const DeepLevel3 = () => {
  return <div>Level 3</div>;
};

const DeepLevel2 = () => {
  return (
    <div>
      Level 2
      <DeepLevel3 />
    </div>
  );
};

const DeepLevel1 = () => {
  return (
    <div>
      Level 1
      <DeepLevel2 />
    </div>
  );
};

export const DeepApp = () => {
  const data = useDeep1();
  return (
    <div>
      <DeepLevel1 />
      {data}
    </div>
  );
};

const useDeep3 = () => {
  return "Deep Data";
};

const useDeep2 = () => {
  return useDeep3();
};

const useDeep1 = () => {
  return useDeep2();
};

export const DeepDependency = ({ location }: any) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0);
  }, [location?.pathname]);
  return <div>{progress}</div>;
};
