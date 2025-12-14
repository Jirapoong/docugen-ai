import React, { useState, useEffect, useRef } from 'react';

interface SmartImageProps {
  src: string;
  alt: string;
  isZoomed?: boolean;
  className?: string;
}

export const SmartImage: React.FC<SmartImageProps> = ({ 
  src, 
  alt, 
  isZoomed = false,
  className = '' 
}) => {
  // Store the current display image and previous image for crossfading
  const [displayedImg, setDisplayedImg] = useState<{ src: string, id: number }>({ src, id: 0 });
  const [prevImg, setPrevImg] = useState<{ src: string, id: number } | null>(null);
  
  const counter = useRef(0);

  useEffect(() => {
    // Only update if src actually changes
    if (src !== displayedImg.src) {
      counter.current += 1;
      setPrevImg(displayedImg);
      setDisplayedImg({ src, id: counter.current });
      
      // Remove previous image after transition completes (1000ms)
      const timer = setTimeout(() => {
        setPrevImg(null);
      }, 1000); 
      return () => clearTimeout(timer);
    }
  }, [src, displayedImg]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gray-950 ${className}`}>
        {/* Render Previous Image (Behind) */}
        {prevImg && (
            <SingleImage 
               key={prevImg.id} 
               src={prevImg.src} 
               alt={alt} 
               isZoomed={isZoomed}
               isFadingOut={true}
            />
        )}
        
        {/* Render Current Image (Front) */}
        <SingleImage 
           key={displayedImg.id}
           src={displayedImg.src}
           alt={alt}
           isZoomed={isZoomed}
           isFadingOut={false}
        />

        {/* Cinematic Overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/40 via-transparent to-black/10 z-20"></div>
    </div>
  );
};

// Sub-component to manage individual image state and animations
interface SingleImageProps {
  src: string;
  alt: string;
  isZoomed: boolean;
  isFadingOut: boolean;
}

const SingleImage: React.FC<SingleImageProps> = ({ src, alt, isZoomed, isFadingOut }) => {
    const [loaded, setLoaded] = useState(false);
    const [startZoom, setStartZoom] = useState(false);

    useEffect(() => {
        // Delay zoom start slightly to ensure 'scale-100' is applied first, triggering CSS transition
        const timer = setTimeout(() => setStartZoom(true), 50);
        return () => clearTimeout(timer);
    }, []);

    return (
        <img
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            className={`
                absolute inset-0 w-full h-full object-cover
                transition-opacity duration-1000 ease-in-out
                ${isFadingOut ? 'z-0' : 'z-10'}
                ${loaded ? 'opacity-100' : 'opacity-0'}
                transform transition-transform duration-[20s] ease-linear will-change-transform
                ${(isZoomed && startZoom) ? 'scale-110' : 'scale-100'}
            `}
        />
    );
};