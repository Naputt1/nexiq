import React from "react";
import { Box, Text } from "ink";
import type { ButtonProps } from "./types";

// ─── Button ─────────────────────────────────────────────────────────────────

const Button: React.FC<ButtonProps> = ({
  children,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  width,
}) => {
  const variantColors: Record<string, string> = {
    primary: "cyan",
    secondary: "gray",
    danger: "red",
  };

  const borderColor = disabled ? "gray" : variantColors[variant] ?? "cyan";

  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width={width}
    >
      {loading ? (
        <Text color={borderColor}>⏳ {children}</Text>
      ) : (
        <Text
          bold
          color={borderColor}
          dimColor={disabled}
          underline={!disabled && !!onPress}
        >
          {children}
        </Text>
      )}
    </Box>
  );
};

export default Button;
export type { ButtonProps };