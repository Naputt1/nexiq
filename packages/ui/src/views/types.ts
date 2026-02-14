import { type JsonData, type TypeDataDeclare } from "shared";
import { type useGraphProps } from "../graph/hook";

export interface GraphViewResult extends useGraphProps {
  typeData: Record<string, TypeDataDeclare>;
}

export type GraphViewGenerator = (data: JsonData) => GraphViewResult;
