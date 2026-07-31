"use client";

import { useState } from "react";
import { DIAL_MODES, type DialMode } from "@/lib/types";
import { Select } from "@/components/ui";

export function DialModeSelect({ defaultValue }: { defaultValue: DialMode }) {
  const [mode, setMode] = useState<DialMode>(defaultValue);
  const selectedMode = DIAL_MODES.find((item) => item.value === mode) ?? DIAL_MODES[0];

  return (
    <div className="space-y-2">
      <Select
        name="dial_mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as DialMode)}
        aria-describedby="dial-mode-description"
      >
        {DIAL_MODES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>

      <div
        id="dial-mode-description"
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span className="font-medium text-foreground">{selectedMode.label}: </span>
        {selectedMode.description}
      </div>
    </div>
  );
}
