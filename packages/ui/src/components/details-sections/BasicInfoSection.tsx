import React from "react";
import type { DetailSectionProps } from "@react-map/extension-sdk";

export const BasicInfoSection: React.FC<DetailSectionProps> = ({ item }) => {
  return (
    <div className="space-y-1">
      <div className="flex gap-2 text-xs">
        <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
          ID:
        </span>
        <span className="truncate text-muted-foreground" title={item.id}>
          {item.id}
        </span>
      </div>

      {item.fileName && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            File:
          </span>
          <span className="text-muted-foreground break-all text-start">
            {item.fileName}
          </span>
        </div>
      )}

      {item.declarationKind && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            Kind:
          </span>
          <span className="text-muted-foreground">
            {item.declarationKind}
          </span>
        </div>
      )}

      {item.tag && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            Tag:
          </span>
          <span className="text-muted-foreground">{item.tag}</span>
        </div>
      )}
    </div>
  );
};
