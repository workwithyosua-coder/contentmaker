"use client";

import { createContext, useContext, useState } from "react";

/**
 * The recording booth's "an AI batch is running" flag, shared across its cards: while "Redo all" voices lines, the
 * voice pickers, the single-line redo and the full voice-over upload are locked so nothing races the batch.
 */
const BoothBusy = createContext<{ busy: boolean; setBusy: (b: boolean) => void }>({ busy: false, setBusy: () => {} });

export function BoothBusyProvider({ children }: { children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return <BoothBusy.Provider value={{ busy, setBusy }}>{children}</BoothBusy.Provider>;
}

export const useBoothBusy = () => useContext(BoothBusy);
