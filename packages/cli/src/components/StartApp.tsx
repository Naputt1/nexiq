import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import {
  isServerAlive,
  startServerDetached,
  BACKEND_PORT,
} from "../server-process.js";
import { COLORS, NexiqBanner, KvRow, StatusDot } from "./ui.js";

interface StartAppProps {
  port?: number;
}

type Phase = "checking" | "starting" | "done" | "error";

export function StartApp({ port = BACKEND_PORT }: StartAppProps) {
  const { exit } = useApp();

  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
  const [pid, setPid] = useState<number | undefined>();
  const [alreadyRunning, setAlreadyRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Phase 1: check if already alive
      const alive = await isServerAlive(port);
      if (cancelled) return;

      if (alive) {
        setAlreadyRunning(true);
        setPhase("done");
        setMessage(`Server is already running on ws://localhost:${port}`);
        setTimeout(() => exit(), 600);
        return;
      }

      // Phase 2: start detached
      setPhase("starting");
      const result = await startServerDetached(port);
      if (cancelled) return;

      if (result.ok) {
        setPid(result.pid);
        setPhase("done");
        setMessage(`Server started on ws://localhost:${port}`);
      } else {
        setPhase("error");
        setMessage(result.error ?? "Unknown error");
      }
      setTimeout(() => exit(), result.ok ? 800 : 1200);
    }

    run().catch((e) => {
      if (!cancelled) {
        setPhase("error");
        setMessage(e instanceof Error ? e.message : String(e));
        setTimeout(() => exit(), 1200);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <NexiqBanner />

      {phase === "checking" && (
        <Box>
          <Text color={COLORS.cyan}>
            <Spinner type="dots" />
          </Text>
          <Text> Checking server…</Text>
        </Box>
      )}

      {phase === "starting" && (
        <Box>
          <Text color={COLORS.cyan}>
            <Spinner type="dots" />
          </Text>
          <Text> Starting server on port {port}…</Text>
        </Box>
      )}

      {phase === "done" && (
        <Box flexDirection="column" gap={0}>
          <Box gap={1}>
            <StatusDot running={true} />
            <Text color={COLORS.green} bold>
              {alreadyRunning ? "Already running" : "Server started"}
            </Text>
          </Box>
          <KvRow label="Address" value={`ws://localhost:${port}`} />
          {pid !== undefined && (
            <KvRow label="PID" value={String(pid)} />
          )}
          <Box marginTop={1}>
            <Text color={COLORS.muted}>{message}</Text>
          </Box>
        </Box>
      )}

      {phase === "error" && (
        <Box flexDirection="column" gap={0}>
          <Box gap={1}>
            <StatusDot running={false} />
            <Text color={COLORS.red} bold>
              Failed to start server
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
