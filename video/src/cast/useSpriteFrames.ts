import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { measureSprite, spriteBox } from "./spriteFrame";

/**
 * Measures the uploaded sprites before the first frame is captured: the renderer waits (delayRender), the composition
 * re-renders with the measurements, and only then is the frame released, so every frame frames them the same way.
 * In the preview they're measured before playback, so there's nothing left to do here.
 */
export function useSpriteFrames(urls: string[]) {
  const todo = urls.filter((u) => /^(https?:|\/)/.test(u) && !spriteBox(u));
  const key = todo.join("|");
  const [handle] = useState(() => (todo.length ? delayRender("Measuring uploaded sprites", { timeoutInMilliseconds: 60000 }) : null));
  const [measured, setMeasured] = useState(handle === null);

  useEffect(() => {
    if (handle === null || measured) return;
    let live = true;
    Promise.all(key.split("|").filter(Boolean).map((u) => measureSprite(u))).finally(() => live && setMeasured(true));
    return () => {
      live = false;
    };
  }, [handle, key, measured]);

  // released after the re-render with the measurements has been committed
  useEffect(() => {
    if (handle !== null && measured) continueRender(handle);
  }, [handle, measured]);
}
