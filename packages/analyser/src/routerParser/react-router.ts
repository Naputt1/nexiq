import { RouterParser } from "./index.ts";

export class ReactRouterParser extends RouterParser {
  public based: "code" | "file" | "declare" | null = null;
  public routerType = "react-router";

  constructor() {
    super();
  }
}
