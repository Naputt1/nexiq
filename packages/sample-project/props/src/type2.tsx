import React from "react";

export type Test2 = (string);

export type Test3 =
  | ({
      title?: string;
      items: string[];
    } & {
      title: string;
    })
  | {
      title: string;
    };

export interface Child4 {
  title: string;
  items?: string[];
}
