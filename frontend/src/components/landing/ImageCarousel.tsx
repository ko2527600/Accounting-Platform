import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CarouselSlide {
  src: string;
  alt: string;
  caption: string;
}

const SLIDES: CarouselSlide[] = [
  {
    src: "/landing/slide-workdesk.jpg",
    alt: "Team reviewing financial notes across two laptops",
    caption: "Real bookkeeping, done right, every day",
  },
  {
    src: "/landing/slide-taxdocs.jpg",
    alt: "Calculator and tax withholding forms on a desk",
    caption: "Stay tax-ready without the year-end scramble",
  },
  {
    src: "/landing/slide-charts.jpg",
    alt: "Financial charts and a calculator on a desk",
    caption: "See exactly where your money is going",
  },
];

const AUTO_ADVANCE_MS = 5000;

export function ImageCarousel() {
  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((next: number) => {
    setIndex(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (isPaused) return;
    timerRef.current = setInterval(() => {
      setIndex((current) => (current + 1) % SLIDES.length);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused]);

  return (
    <div
      className="relative w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-secondary-800 shadow-xl shadow-black/30"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-label="Business and accounting photo carousel"
    >
      <div className="relative aspect-[16/9] sm:aspect-[21/9] bg-secondary-900">
        <div
          className="flex h-full transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {SLIDES.map((slide) => (
            <div key={slide.src} className="relative w-full h-full flex-shrink-0">
              <img
                src={slide.src}
                alt={slide.alt}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-950/90 via-secondary-950/10 to-transparent" />
              <p className="absolute bottom-5 left-6 right-6 text-white text-base sm:text-lg font-bold drop-shadow-md">
                {slide.caption}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label="Previous slide"
          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-secondary-950/60 text-white hover:bg-secondary-950/90 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label="Next slide"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-secondary-950/60 text-white hover:bg-secondary-950/90 transition-colors"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 py-4 bg-secondary-900">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === index}
            className={`h-2 rounded-full transition-all ${
              i === index ? "w-6 bg-emerald-400" : "w-2 bg-secondary-700 hover:bg-secondary-600"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
