import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  getCacheEntries,
  clearCacheEntries,
  formatBytes,
  type CacheEntry,
} from "../server-process.js";
import {
  COLORS,
  NexiqBanner,
  Divider,
  SectionTitle,
} from "./ui.js";

interface CacheAppProps {
  /** If true, clear cache without confirmation (use --force flag) */
  clear?: boolean;
  force?: boolean;
}

type Phase =
  | "loading"
  | "list"
  | "confirm-clear"
  | "clearing"
  | "cleared"
  | "no-cache"
  | "error";

export function CacheApp({ clear = false, force = false }: CacheAppProps) {
  const { exit } = useApp();

  const [phase, setPhase] = useState<Phase>("loading");
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    try {
      const found = getCacheEntries();
      setEntries(found);

      if (found.length === 0) {
        setPhase("no-cache");
        setTimeout(() => exit(), 600);
        return;
      }

      if (clear) {
        if (force) {
          // Clear immediately
          setPhase("clearing");
          clearCacheEntries(found);
          setPhase("cleared");
          setTimeout(() => exit(), 800);
        } else {
          setPhase("confirm-clear");
        }
      } else {
        setPhase("list");
        // Auto-exit after display
        setTimeout(() => exit(), 5000);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
      setTimeout(() => exit(), 1200);
    }
  }, []);

  // Handle keyboard for confirmation
  useInput((input, key) => {
    if (phase !== "confirm-clear") return;

    if (input.toLowerCase() === "y") {
      setPhase("clearing");
      try {
        clearCacheEntries(entries);
        setPhase("cleared");
        setTimeout(() => exit(), 800);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
        setTimeout(() => exit(), 1200);
      }
    } else if (input.toLowerCase() === "n" || key.escape) {
      setPhase("list");
      setTimeout(() => exit(), 600);
    }
  });

  const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);

  return (
    <Box flexDirection="column" padding={1}>
      <NexiqBanner />
      <SectionTitle title="Cache" />

      {phase === "loading" && (
        <Box gap={1}>
          <Text color={COLORS.cyan}>
            <Spinner type="dots" />
          </Text>
          <Text> Scanning cache…</Text>
        </Box>
      )}

      {phase === "no-cache" && (
        <Box marginTop={1}>
          <Text color={COLORS.muted}>No cache entries found in ~/.nexiq/</Text>
        </Box>
      )}

      {(phase === "list" || phase === "confirm-clear") && (
        <Box flexDirection="column" marginTop={1}>
          {entries.map((entry, i) => (
            <Box key={i} flexDirection="column" marginBottom={0}>
              <Box gap={2}>
                <Box flexGrow={1}>
                  <Text color={COLORS.white} wrap="truncate">
                    {entry.label}
                  </Text>
                </Box>
                <Text color={COLORS.muted}>{formatBytes(entry.sizeBytes)}</Text>
                <Text color={COLORS.muted}>
                  {entry.lastModified.toLocaleDateString()}
                </Text>
              </Box>
            </Box>
          ))}

          <Divider />
          <Box gap={2}>
            <Text color={COLORS.cyan} bold>
              {entries.length} entries
            </Text>
            <Text color={COLORS.muted}>{formatBytes(totalBytes)} total</Text>
          </Box>

          {phase === "confirm-clear" && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={COLORS.yellow} bold>
                ⚠ Clear all cache? This cannot be undone. (y/N)
              </Text>
            </Box>
          )}

          {phase === "list" && !clear && (
            <Box marginTop={1}>
              <Text color={COLORS.muted}>
                Run{" "}
                <Text color={COLORS.accent} bold>
                  nexiq cache clear
                </Text>{" "}
                to remove all entries.
              </Text>
            </Box>
          )}
        </Box>
      )}

      {phase === "clearing" && (
        <Box gap={1} marginTop={1}>
          <Text color={COLORS.cyan}>
            <Spinner type="dots" />
          </Text>
          <Text> Clearing…</Text>
        </Box>
      )}

      {phase === "cleared" && (
        <Box marginTop={1}>
          <Text color={COLORS.green} bold>
            ✓ Cache cleared ({entries.length} entries, {formatBytes(totalBytes)})
          </Text>
        </Box>
      )}

      {phase === "error" && (
        <Box marginTop={1}>
          <Text color={COLORS.red}>{errorMsg}</Text>
        </Box>
      )}
    </Box>
  );
}
