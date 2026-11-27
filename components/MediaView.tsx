"use client";
import { useEffect, useRef } from "react";
import { useInView } from "@/lib/hooks";
import type { Item } from "@/lib/types";

/** `small`: a card-sized view, which shows a still picture's smaller copy (media.thumb) when it has one. */
type Props = { item: Item; fit?: "cover" | "contain"; eager?: boolean; controls?: boolean; small?: boolean };

/** A video's length as 0:08 or 1:24. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/**
 * Renders any media type; videos and Lottie only play while on screen. A video shows its poster until it
 * plays, and a card (`small`) plays its lighter copy. With reduced motion, a card's video plays only while
 * the pointer is on it.
 */
export default function MediaView({ item, fit = "cover", eager, controls, small }: Props) {
  const { media, title } = item;
  const [ref, inView] = useInView<HTMLDivElement>("100px");
  const videoRef = useRef<HTMLVideoElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<{ play(): void; pause(): void; destroy(): void } | null>(null);
  const still = () => !controls && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (inView && !still()) v.play().catch(() => {});
    else v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);
  const hover = (on: boolean) => {
    const v = videoRef.current;
    if (!v || !still()) return;
    if (on) v.play().catch(() => {});
    else v.pause();
  };

  useEffect(() => {
    if (media.type !== "lottie" || !inView) {
      animRef.current?.pause();
      return;
    }
    if (animRef.current) {
      animRef.current.play();
      return;
    }
    let cancelled = false;
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (cancelled || !lottieRef.current) return;
      animRef.current = lottie.loadAnimation({
        container: lottieRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: media.src,
        rendererSettings: { preserveAspectRatio: fit === "cover" ? "xMidYMid slice" : "xMidYMid meet" },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [inView, media.type, media.src, fit]);

  useEffect(() => () => animRef.current?.destroy(), []);

  return (
    <div
      ref={ref}
      className={`media media--${fit}`}
      data-type={media.type}
      onPointerEnter={media.type === "video" ? () => hover(true) : undefined}
      onPointerLeave={media.type === "video" ? () => hover(false) : undefined}
    >
      {media.type === "video" ? (
        <video
          ref={videoRef}
          src={small && media.small ? media.small : media.src}
          poster={media.thumb}
          muted
          loop
          playsInline
          preload={eager ? "auto" : media.thumb ? "none" : "metadata"}
          controls={controls}
          aria-label={title}
        />
      ) : media.type === "lottie" ? (
        <div ref={lottieRef} className="media-lottie" role="img" aria-label={title} />
      ) : (
        <img src={small && media.thumb ? media.thumb : media.src} alt={title} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
      )}
    </div>
  );
}
