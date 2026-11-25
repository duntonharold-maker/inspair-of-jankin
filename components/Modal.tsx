"use client";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
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
  const panelRef = useRef<HTMLDivElement>(null);

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
      else if (e.key === "Tab") keepFocusInside(e);
    };
    // Tab and Shift+Tab go round the panel's controls instead of wandering onto the page behind it
    const keepFocusInside = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const stops = [...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, summary, video[controls], [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.getClientRects().length > 0);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      const inside = at instanceof Node && panel.contains(at);
      if (e.shiftKey ? at === first || !inside : at === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="modal-scrim" onClick={onClose} />
      <div ref={panelRef} className="modal-panel">
        <div className="modal-bar">
          <button className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="上一张">
            <ArrowLeft />
          </button>
          <button className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="下一张">
            <ArrowRight />
          </button>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        <ItemDetail key={item.id} item={item} site={site} />
      </div>
    </div>
  );
}
