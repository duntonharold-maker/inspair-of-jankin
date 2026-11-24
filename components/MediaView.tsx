"use client";
import { useEffect, useRef } from "react";
import { useInView } from "@/lib/hooks";
import type { Item } from "@/lib/types";

type Props = { item: Item; fit?: "cover" | "contain"; eager?: boolean; controls?: boolean };

/** Renders any media type; videos and Lottie only play while on screen. */
export default function MediaView({ item, fit = "cover", eager, controls }: Props) {
  const { media, title } = item;
  const [ref, inView] = useInView<HTMLDivElement>("100px");
  const videoRef = useRef<HTMLVideoElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<{ play(): void; pause(): void; destroy(): void } | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (inView) v.play().catch(() => {});
    else v.pause();
  }, [inView]);

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
    <div ref={ref} className={`media media--${fit}`} data-type={media.type}>
      {media.type === "video" ? (
        <video
          ref={videoRef}
          src={media.src}
          muted
          loop
          playsInline
          preload={eager ? "auto" : "metadata"}
          controls={controls}
          aria-label={title}
        />
      ) : media.type === "lottie" ? (
        <div ref={lottieRef} className="media-lottie" role="img" aria-label={title} />
      ) : (
        <img src={media.src} alt={title} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
      )}
    </div>
  );
}
