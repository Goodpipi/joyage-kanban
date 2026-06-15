import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface Props {
  images: string[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

export function ImagePreviewDialog({ images, index, onIndexChange }: Props) {
  const open = index !== null && index >= 0 && index < images.length;
  const current = open ? images[index!] : null;

  const goPrev = () => {
    if (index === null || images.length <= 1) return;
    onIndexChange((index - 1 + images.length) % images.length);
  };

  const goNext = () => {
    if (index === null || images.length <= 1) return;
    onIndexChange((index + 1) % images.length);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onIndexChange(null)}>
      <DialogContent
        className="flex max-h-[96vh] max-w-[96vw] flex-col gap-0 border-0 bg-black/92 p-3 shadow-2xl sm:max-w-[96vw] sm:rounded-xl"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") goPrev();
          if (e.key === "ArrowRight") goNext();
        }}
      >
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        {current && (
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {images.length > 1 && (
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-1 z-10 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="上一张"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <img
              src={current}
              alt=""
              className="max-h-[calc(96vh-3rem)] max-w-full object-contain"
            />
            {images.length > 1 && (
              <button
                type="button"
                onClick={goNext}
                className="absolute right-1 z-10 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="下一张"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        {images.length > 1 && index !== null && (
          <p className="mt-2 text-center text-xs text-white/70">
            {index + 1} / {images.length}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ThumbnailProps {
  src: string;
  alt?: string;
  className?: string;
  onPreview: () => void;
}

export function ClickableImageThumbnail({ src, alt = "", className, onPreview }: ThumbnailProps) {
  return (
    <button
      type="button"
      onClick={onPreview}
      className="block w-full cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-border transition hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label="查看大图"
    >
      <img src={src} alt={alt} className={className} />
    </button>
  );
}
