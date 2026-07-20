import React from "react";
import { Box, Text } from "ink";

// ─── Sub-component: ModalHeader ─────────────────────────────────────────────

interface ModalHeaderProps {
  title: string;
  onClose?: () => void;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ title, onClose }) => {
  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      justifyContent="space-between"
      paddingX={1}
    >
      <Text bold color="cyan">
        {title}
      </Text>
      {onClose && (
        <Text color="gray" dimColor>
          [X] Close
        </Text>
      )}
    </Box>
  );
};

// ─── Sub-component: ModalBody ───────────────────────────────────────────────

interface ModalBodyProps {
  children: React.ReactNode;
}

const ModalBody: React.FC<ModalBodyProps> = ({ children }) => {
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      borderStyle="round"
      borderColor="gray"
    >
      {children}
    </Box>
  );
};

// ─── Sub-component: ModalFooter ─────────────────────────────────────────────

interface ModalFooterProps {
  children?: React.ReactNode;
  helpText?: string;
}

const ModalFooter: React.FC<ModalFooterProps> = ({ children, helpText }) => {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {children}
      {helpText && (
        <Text color="gray" dimColor>
          {helpText}
        </Text>
      )}
    </Box>
  );
};

// ─── GenericModal ────────────────────────────────────────────────────────────

interface GenericModalProps {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  helpText?: string;
  onClose?: () => void;
  borderColor?: string;
}

const GenericModal: React.FC<GenericModalProps> = ({
  title,
  children,
  footer,
  helpText,
  onClose,
  borderColor = "cyan",
}) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={borderColor}
      padding={1}
    >
      <ModalHeader title={title} onClose={onClose} />
      <ModalBody>{children}</ModalBody>
      <ModalFooter helpText={helpText}>{footer}</ModalFooter>
    </Box>
  );
};

export default GenericModal;
export { ModalHeader, ModalBody, ModalFooter };
export type { ModalHeaderProps, ModalBodyProps, ModalFooterProps, GenericModalProps };