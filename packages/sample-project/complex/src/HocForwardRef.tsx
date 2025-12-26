import React, { memo, forwardRef } from 'react';

export const MemoizedComponent = memo(function Memoized({ name }: { name: string }) {
  return <div>Hello {name}</div>;
});

export const ForwardRefComponent = forwardRef<HTMLDivElement, { label: string }>((props, ref) => {
  return <div ref={ref}>{props.label}</div>;
});

const withLogging = (Wrapped: React.ComponentType<any>) => {
  return (props: any) => {
    console.log('Rendering HOC');
    return <Wrapped {...props} />;
  };
};

export const WrappedComponent = withLogging(() => <div>Wrapped</div>);
