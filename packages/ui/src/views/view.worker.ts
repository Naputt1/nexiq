import { type JsonData } from "shared";
import { generateComponentGraphData } from "./componentView";
import { type GraphViewType } from "../../electron/types";

export type ViewWorkerRequest = {
  type: GraphViewType;
  data: JsonData;
};

export type ViewWorkerResponse = {
  result: any;
};

self.onmessage = (e: MessageEvent<ViewWorkerRequest>) => {
  const { type, data } = e.data;
  
  let result;
  if (type === "component") {
    result = generateComponentGraphData(data);
  }
  
  self.postMessage({ result });
};
