export interface ButtonProps {
  /** The label displayed on the button */
  children: React.ReactNode;
  /** Called when the button is pressed */
  onPress?: () => void;
  /** Visual variant of the button */
  variant?: "primary" | "secondary" | "danger";
  /** Disables interaction */
  disabled?: boolean;
  /** Show a loading spinner */
  loading?: boolean;
  /** Optional width (in columns) */
  width?: number;
}
