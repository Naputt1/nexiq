import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import {
  getServerStatus,
  resolveServerDist,
  BACKEND_PORT,
  formatDuration,
  type ServerStatus,
} from "../server-process.js";
import {
  COLORS,
  NexiqBanner,
  KvRow,
  StatusDot,
  Divider,
  SectionTitle,
} from "./ui.js";

interface StatusAppProps {
  port?: number;
}

export function StatusApp({ port = BACKEND_PORT }: StatusAppProps) {
  const { exit } = useApp();

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getServerStatus(port).then((s) => {
      if (!cancelled) {
        setStatus(s);
        setLoading(false);
        setTimeout(() => exit(), 800);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <NexiqBanner />
      <SectionTitle title="Server Status" />

      {loading && (
        <Box gap={1}>
          <Text color={COLORS.cyan}>
            <Spinner type="dots" />
          </Text>
          <Text> Checking…</Text>
        </Box>
      )}

      {!loading && status && (
        <Box flexDirection="column" marginTop={1}>
          {/* Running indicator */}
          <Box gap={1} marginBottom={1}>
            <StatusDot running={status.running} />
            <Text color={status.running ? COLORS.green : COLORS.red} bold>
              {status.running ? "Running" : "Stopped"}
            </Text>
          </Box>

          <Divider />

          {status.running && (
            <>
              {status.port !== undefined && (
                <KvRow
                  label="Port"
                  value={String(status.port)}
                  valueColor={COLORS.cyan}
                />
              )}
              {status.pid !== undefined && (
                <KvRow label="PID" value={String(status.pid)} />
              )}
              {status.uptimeMs !== undefined && (
                <KvRow
                  label="Uptime"
                  value={formatDuration(status.uptimeMs)}
                  valueColor={COLORS.green}
                />
              )}
            </>
          )}

          <KvRow
            label="Server dist"
            value={status.serverDist ?? "(not found)"}
            valueColor={status.serverDist ? COLORS.muted : COLORS.red}
          />
          <KvRow label="Log file" value={status.logFile} valueColor={COLORS.muted} />

          {!status.running && (
            <Box marginTop={1}>
              <Text color={COLORS.muted}>
                Run{" "}
                <Text color={COLORS.accent} bold>
                  nexiq start
                </Text>{" "}
                to launch the server.
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
