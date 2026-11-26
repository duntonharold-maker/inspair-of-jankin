"use client";
import { Images } from "lucide-react";
import MediaView from "./MediaView";
import { useCopy } from "@/lib/hooks";
import type { Category, Item } from "@/lib/types";

export function ratioOf(item: Item) {
  const { width, height } = item.media;
  return width && height ? width / height : item.media.type === "video" ? 4 / 3 : 1;
}

export default function Card({
  item,
  category,
  onOpen,
}: {
  item: Item;
  category?: Category;
  onOpen: (id: string) => void;
}) {
  const { copied, copy } = useCopy();
  return (
    <article className="card">
      <div className="card-frame">
        <button
          className={`card-media${item.media.cutout ? " is-cutout" : ""}`}
          style={{ aspectRatio: String(Math.min(2.2, Math.max(0.45, ratioOf(item)))) }}
          onClick={() => onOpen(item.id)}
          aria-label={`查看「${item.title}」`}
        >
          <MediaView item={item} fit={item.media.cutout ? "contain" : "cover"} small />
          {item.gallery?.length ? (
            <span className="card-count" aria-label={`一组 ${item.gallery.length + 1} 张`}>
              <Images aria-hidden />
              {item.gallery.length + 1}
            </span>
          ) : null}
        </button>
        {item.prompt && (
          <button className="card-copy" onClick={() => copy(item.prompt!)}>
            {copied ? "已复制" : "复制提示词"}
          </button>
        )}
      </div>
      <div className="card-meta">
        <span className="card-title">{item.title}</span>
        <span className="card-sub">
          {category?.label ?? item.category}
          {item.model ? ` · ${item.model}` : ""}
          {item.prompt ? <span className="card-dot" title="带提示词" /> : null}
        </span>
      </div>
    </article>
  );
}
