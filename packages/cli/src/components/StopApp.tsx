import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { stopServer, BACKEND_PORT } from "../server-process.js";
import { COLORS, NexiqBanner, StatusDot } from "./ui.js";

interface StopAppProps {
  port?: number;
}

type Phase = "stopping" | "done" | "error";

export function StopApp({ port = BACKEND_PORT }: StopAppProps) {
  const { exit } = useApp();

  const [phase, setPhase] = useState<Phase>("stopping");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const result = await stopServer();
      if (cancelled) return;

      if (result.ok) {
        setPhase("done");
      } else {
        setPhase("error");
      }
      setMessage(result.message);
      setTimeout(() => exit(), 800);
    }

    run().catch((e) => {
      if (!cancelled) {
        setPhase("error");
        setMessage(e instanceof Error ? e.message : String(e));
        setTimeout(() => exit(), 1000);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <NexiqBanner />

      {phase === "stopping" && (
        <Box>
          <Text color={COLORS.cyan}>
            <Spinner type="dots" />
          </Text>
          <Text> Stopping server…</Text>
        </Box>
      )}

      {phase === "done" && (
        <Box flexDirection="column">
          <Box gap={1}>
            <StatusDot running={false} />
            <Text color={COLORS.green} bold>
              Stopped
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.muted}>{message}</Text>
          </Box>
        </Box>
      )}

      {phase === "error" && (
        <Box flexDirection="column">
          <Box gap={1}>
            <StatusDot running={false} />
            <Text color={COLORS.red} bold>
              Error
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.red}>{message}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
