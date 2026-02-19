import React from "react";
import type { DetailSectionProps } from "@react-map/extension-sdk";
import { getDisplayName } from "shared";

export const HooksSection: React.FC<DetailSectionProps> = ({
  item,
  graph,
  onSelect,
}) => {
  if (!item.hooks || item.hooks.length === 0) return null;

  return (
    <div className="space-y-1">
      {item.hooks.map((hookId: string) => {
        const hookItem = graph.getPointByID(hookId);
        return (
          <div
            key={hookId}
            className="flex items-center justify-between text-xs font-mono bg-muted/30 p-2 rounded border border-border/50 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onSelect?.(hookId)}
          >
            <span className="text-primary">
              {hookItem ? getDisplayName(hookItem.name) : hookId}
            </span>
          </div>
        );
      })}
    </div>
  );
};
