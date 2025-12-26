export const fullDebug = () => {
  if (process.env.FULL_DEBUG === "true") {
    debugger;
  }
};
