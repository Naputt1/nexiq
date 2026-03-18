import React, { forwardRef, forwardRef as aliasedFR } from 'react';

// Case 1: forwardRef
const ForwardRefComp = forwardRef((props, ref) => {
  return <div ref={ref}>ForwardRef</div>;
});

// Case 2: React.forwardRef
const ReactForwardRefComp = React.forwardRef((props, ref) => {
  return <div ref={ref}>ReactForwardRef</div>;
});

// Case 3: Aliased forwardRef
const AliasedForwardRefComp = aliasedFR((props, ref) => {
  return <div ref={ref}>AliasedForwardRef</div>;
});

// Case 3b: forwardRef where ref is not used
const ForwardRefNoRefComp = forwardRef((props, ref) => {
  return <div>ForwardRefNoRef</div>;
});

// Case 4: React 19 style ref prop (referenced)
function React19RefComp({ ref, children }) {
  return <div ref={ref}>{children}</div>;
}

// Case 5: React 19 style ref prop (not referenced)
function React19NoRefComp({ ref, children }) {
  return <div>{children}</div>;
}

// Case 6: React 19 style ref prop as normal parameter (referenced)
function React19RefParamComp(props) {
  return <div ref={props.ref}>{props.children}</div>;
}

// Case 7: React 19 style ref prop as normal parameter (not referenced)
function React19NoRefParamComp(props) {
  return <div>{props.children}</div>;
}

// Case 8: Arrow function component with ref usage (React 19 style)
const ArrowRefComp = ({ ref, children }) => {
  return <div ref={ref}>{children}</div>;
};

export default function App() {
  return (
    <div>
      <ForwardRefComp />
      <ReactForwardRefComp />
      <AliasedForwardRefComp />
      <ForwardRefNoRefComp />
      <React19RefComp>Ref</React19RefComp>
      <React19NoRefComp>No Ref</React19NoRefComp>
      <React19RefParamComp>Ref Param</React19RefParamComp>
      <React19NoRefParamComp>No Ref Param</React19NoRefParamComp>
      <ArrowRefComp>Arrow Ref</ArrowRefComp>
    </div>
  );
}
