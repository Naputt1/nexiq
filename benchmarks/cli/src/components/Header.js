import React from "react";
import { Box, Text } from "ink";
import NavLink from "./NavLink.js";

const STEP_LABELS = [
  { label: "Projects", value: "projects" },
  { label: "Models", value: "models" },
  { label: "Test Types", value: "testTypes" },
  { label: "Approaches", value: "approaches" },
  { label: "Concurrency", value: "concurrency" },
  { label: "Viewer", value: "openViewer" },
  { label: "Running", value: "running" },
  { label: "Finished", value: "finished" },
];

const Header = ({ currentStep }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {STEP_LABELS.map((step, index) => (
          <Box key={step.value}>
            <NavLink to={step.value}>{step.label}</NavLink>
            {index < STEP_LABELS.length - 1 && (
              <Text color="gray"> {" | "} </Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default Header;
