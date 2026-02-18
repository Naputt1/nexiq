import { Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";

interface ZoomSliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  className?: string;
}

export function ZoomSlider({
  value,
  min,
  max,
  onChange,
  className,
}: ZoomSliderProps) {
  // Convert scale to 0-100 for the slider
  // We use log scale for better zoom feel
  const toPercentage = (v: number) => {
    return ((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
  };

  const fromPercentage = (p: number) => {
    return Math.exp(Math.log(min) + (p / 100) * (Math.log(max) - Math.log(min)));
  };

  const handleSliderChange = (vals: number[]) => {
    onChange(fromPercentage(vals[0]));
  };

  const step = 1.1;

  return (
    <div className={cn("flex flex-col items-center gap-4 bg-popover/80 backdrop-blur-sm border border-border p-2 rounded-full shadow-lg", className)}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={() => onChange(Math.min(max, value * step))}
      >
        <Plus className="h-4 w-4" />
      </Button>

      <div className="h-48 py-2">
        <Slider
          orientation="vertical"
          min={0}
          max={100}
          step={0.1}
          value={[toPercentage(value)]}
          onValueChange={handleSliderChange}
          className="h-full"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={() => onChange(Math.max(min, value / step))}
      >
        <Minus className="h-4 w-4" />
      </Button>

      <div className="text-[10px] font-bold text-muted-foreground select-none pb-1">
        {Math.round(value * 100)}%
      </div>
    </div>
  );
}
