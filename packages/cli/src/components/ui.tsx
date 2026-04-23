/**
 * Shared Ink UI primitives — colours, badges, borders.
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
export const COLORS = {
  green: "#22c55e",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  muted: "#6b7280",
  white: "#f9fafb",
  accent: "#a855f7",
};

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

interface BadgeProps {
  label: string;
  color: string;
}

export function Badge({ label, color }: BadgeProps) {
  return (
    <Box>
      <Text color={color} bold>
        {" "}
        {label}{" "}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

interface StatusDotProps {
  running: boolean;
}

export function StatusDot({ running }: StatusDotProps) {
  return (
    <Text color={running ? COLORS.green : COLORS.red} bold>
      {running ? "●" : "○"}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Section title
// ---------------------------------------------------------------------------

interface SectionTitleProps {
  title: string;
}

export function SectionTitle({ title }: SectionTitleProps) {
  return (
    <Box marginTop={1} marginBottom={0}>
      <Text color={COLORS.cyan} bold>
        ── {title} ──
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Key-value row
// ---------------------------------------------------------------------------

interface KvRowProps {
  label: string;
  value: string;
  labelWidth?: number;
  valueColor?: string;
}

export function KvRow({ label, value, labelWidth = 14, valueColor = COLORS.white }: KvRowProps) {
  return (
    <Box>
      <Box width={labelWidth}>
        <Text color={COLORS.muted}>{label}</Text>
      </Box>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Header banner
// ---------------------------------------------------------------------------

export function NexiqBanner() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.accent} bold>
        ╔══════════════════════════╗
      </Text>
      <Text color={COLORS.accent} bold>
        ║   nexiq  server  CLI     ║
      </Text>
      <Text color={COLORS.accent} bold>
        ╚══════════════════════════╝
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export function Divider() {
  return (
    <Box marginY={0}>
      <Text color={COLORS.muted}>{"─".repeat(36)}</Text>
    </Box>
  );
}
