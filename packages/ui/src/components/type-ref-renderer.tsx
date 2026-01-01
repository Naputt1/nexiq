import type { ComboData, NodeData } from "@/graph/hook";
import { useState } from "react";
import type { TypeDataRef } from "shared";
import { TypeRenderer } from "./type-renderer";
import React from "react";
import { TypeColors } from "./type-colors";

interface TypeRendererProps {
  type: TypeDataRef;
  nodes: Record<string, NodeData> | undefined;
  combos: Record<string, ComboData> | undefined;
  depth?: number;
}

export const TypeRefRenderer: React.FC<TypeRendererProps> = ({
  type,
  nodes,
  combos,
  depth = 0,
}) => {
  const [expanded, setExpanded] = useState(false);

  let name = "Unknown";
  if (type.refType === "named") name = type.name;
  if (type.refType === "qualified") name = type.names.join(".");

  // Try to find definition in nodes
  // We look for a node where node.propType is defined and match criteria (e.g. name of the type node)
  // Since we don't have a direct ID map for Ref Name -> Node ID, we might need to search or assume standard ID format
  // The implementation plan suggested ID: `${file.path}#${type.name}`
  // But the Ref doesn't give us the file path directly unless imports are resolved.
  // Quick heuristic: Check if any node in `nodes` has `label.text === name` and `type === 'type' || 'interface'`

  let targetNode: NodeData | undefined = undefined;
  if (nodes) {
    targetNode = Object.values(nodes).find(
      (n) => (n.type === "interface" || n.type === "type") && n.id === name
    );
  }

  if (targetNode && targetNode.propType) {
    return (
      <span>
        <span
          className={TypeColors.reference}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {targetNode.label?.text ?? name}
        </span>
        {type.params && type.params.length > 0 && (
          <span>
            <span className={TypeColors.punctuation}>{"<"}</span>
            {type.params.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className={TypeColors.punctuation}>, </span>}
                <TypeRenderer
                  type={p}
                  nodes={nodes}
                  combos={combos}
                  depth={depth}
                />
              </React.Fragment>
            ))}
            <span className={TypeColors.punctuation}>{">"}</span>
          </span>
        )}
        {expanded && (
          <div className="mt-1 ml-2 border-l-2 border-slate-600 pl-2">
            <TypeRenderer
              type={targetNode.propType}
              nodes={nodes}
              combos={combos}
              depth={depth + 1}
            />
          </div>
        )}
      </span>
    );
  }

  return (
    <span>
      <span className={TypeColors.component}>{name}</span>
      {type.params && type.params.length > 0 && (
        <span>
          <span className={TypeColors.punctuation}>{"<"}</span>
          {type.params.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className={TypeColors.punctuation}>, </span>}
              <TypeRenderer
                type={p}
                nodes={nodes}
                combos={combos}
                depth={depth}
              />
            </React.Fragment>
          ))}
          <span className={TypeColors.punctuation}>{">"}</span>
        </span>
      )}
    </span>
  );
};
