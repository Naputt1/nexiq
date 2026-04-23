import React, { useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { COLORS, NexiqBanner, Divider } from "./ui.js";

interface Command {
  usage: string;
  description: string;
}

const COMMANDS: Command[] = [
  {
    usage: "nexiq start",
    description: "Start the nexiq backend server (runs in background)",
  },
  {
    usage: "nexiq stop",
    description: "Stop the running backend server",
  },
  {
    usage: "nexiq status",
    description: "Show server health, port, PID, and uptime",
  },
  {
    usage: "nexiq cache",
    description: "List all project cache entries and their disk usage",
  },
  {
    usage: "nexiq cache clear",
    description: "Remove all project caches (prompts for confirmation)",
  },
  {
    usage: "nexiq cache clear --force",
    description: "Remove all project caches without confirmation",
  },
];

export function HelpApp() {
  const { exit } = useApp();

  useEffect(() => {
    setTimeout(() => exit(), 8000);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <NexiqBanner />

      <Box marginBottom={1}>
        <Text color={COLORS.muted}>
          React component analysis server — CLI management tool
        </Text>
      </Box>

      <Divider />

      <Box flexDirection="column" marginTop={1} gap={0}>
        {COMMANDS.map((cmd, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text color={COLORS.accent} bold>
              {cmd.usage}
            </Text>
            <Box marginLeft={2}>
              <Text color={COLORS.muted}>{cmd.description}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      <Divider />

      <Box marginTop={1} flexDirection="column" gap={0}>
        <Text color={COLORS.cyan} bold>
          Environment variables
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Box gap={1}>
            <Text color={COLORS.yellow}>REACT_MAP_SERVER_PATH</Text>
            <Text color={COLORS.muted}>Override path to server dist/index.js</Text>
          </Box>
          <Box gap={1}>
            <Text color={COLORS.yellow}>PORT</Text>
            <Text color={COLORS.muted}>
              WebSocket port (default: 3030)
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
