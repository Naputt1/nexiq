import { type JsonData } from "shared";
import {
  type GraphViewResult,
  type GraphViewTask,
} from "@react-map/extension-sdk";

export type { GraphViewResult, GraphViewTask };

export type ViewWorkerResponse = {
  result: GraphViewResult;
};

export type GraphViewGenerator = (data: JsonData) => GraphViewResult;
