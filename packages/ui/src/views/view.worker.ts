import { type JsonData } from "shared";
import { generateComponentGraphData } from "./componentView";
import { type GraphViewType } from "../../electron/types";
import { type GraphViewResult } from "./types";

export type ViewWorkerRequest = {
  type: GraphViewType;
  data: JsonData;
};

export type ViewWorkerResponse = {
  result: GraphViewResult;
};

self.onmessage = (e: MessageEvent<ViewWorkerRequest>) => {
  const { type, data } = e.data;

  let result: GraphViewResult | undefined;
  if (type === "component") {
    result = generateComponentGraphData(data);
  }

  if (result) {
    self.postMessage({ result });
  }
};
