"use client";
import { useEffect, useRef } from "react";
import ItemDetail from "./ItemDetail";
import { lockScroll } from "@/lib/scroll";
import type { Item, Site } from "@/lib/types";

export default function Modal({
  item,
  site,
  onClose,
  onPrev,
  onNext,
}: {
  item: Item;
  site: Site;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    lockScroll(true);
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      lockScroll(false);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal-panel">
        <div className="modal-bar">
          <button className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="上一张">
            ←
          </button>
          <button className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="下一张">
            →
          </button>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <ItemDetail key={item.id} item={item} site={site} />
      </div>
    </div>
  );
}
