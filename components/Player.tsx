import React, { useEffect, useRef, useState } from 'react';
import { Chapter } from '../types';
import { Button } from './Button';
import { SmartImage } from './SmartImage';

interface PlayerProps {
  topic: string;
  chapter: Chapter;
  onEnded?: () => void;
  onRetry?: () => void;
}

export const Player: React.FC<PlayerProps> = ({ topic, chapter, onEnded, onRetry }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // Progress of current scene
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);

  useEffect(() => {
    // Reset state when chapter content changes
    if (chapter.content) {
      setIsPlaying(false);
      setProgress(0);
      setIsDownloading(false);
      setCurrentSceneIndex(0);
      
      // Auto-play the first scene
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      }
    }
  }, [chapter.id]); // Depend on ID to reset only when chapter changes

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const p = (audioRef.current.currentTime / audioRef.current.duration) * 100;
      setProgress(p || 0);
    }
  };

  const handleAudioEnded = () => {
    if (!chapter.content?.scenes) return;

    // If there are more scenes in this chapter, advance to next scene
    if (currentSceneIndex < chapter.content.scenes.length - 1) {
      setCurrentSceneIndex(prev => prev + 1);
      // Allow the DOM to update the audio source, then play
      setTimeout(() => {
         if (audioRef.current) {
            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
         }
      }, 0);
    } else {
      // End of chapter
      setIsPlaying(false);
      onEnded?.();
    }
  };

  const handleDownloadVideo = async () => {
    if (!chapter.content?.scenes || isDownloading) return;
    
    // Pause playback
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    setIsDownloading(true);

    try {
      // Download CURRENT scene
      const currentScene = chapter.content.scenes[currentSceneIndex];
      
      // 1. Prepare Canvas
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas init failed");

      // 2. Load Image
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = currentScene.imageUrl;
      });

      // 3. Prepare Audio
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      
      const response = await fetch(currentScene.audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(dest);

      // 4. Setup Recorder
      const stream = new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);
      
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${chapter.title}_scene_${currentSceneIndex + 1}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        audioCtx.close();
        setIsDownloading(false);
      };

      // 5. Draw Loop
      const draw = () => {
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width - img.width * scale) / 2;
        const y = (canvas.height - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

        if (source.context.state === 'running') {
          requestAnimationFrame(draw);
        }
      };

      recorder.start();
      source.start(0);
      draw();

      source.onended = () => {
        recorder.stop();
      };

    } catch (e) {
      console.error("Download failed:", e);
      setIsDownloading(false);
      alert("ไม่สามารถดาวน์โหลดวิดีโอได้ในขณะนี้");
    }
  };

  if (chapter.status === 'generating') {
    return (
      <div className="aspect-video w-full bg-black rounded-xl border border-gray-800 flex flex-col items-center justify-center p-8 text-center space-y-4 shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10"></div>
        <div className="absolute inset-0 bg-gray-900 animate-pulse z-0"></div>
        
        <div className="z-20 flex flex-col items-center">
            <div className="w-16 h-16 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h3 className="text-xl font-bold text-white animate-pulse">กำลังสร้างสาระคดี...</h3>
            <p className="text-gray-400">กำลังเขียนบท และสร้างภาพประกอบ 3 ฉาก</p>
            <p className="text-xs text-gray-500 mt-2 font-mono">{chapter.title}</p>
        </div>
      </div>
    );
  }

  if (chapter.status === 'error' || !chapter.content) {
     return (
      <div className="aspect-video w-full bg-gray-900 rounded-xl border border-gray-800 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="text-red-500 mb-2">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-white">{chapter.errorMessage || "เกิดข้อผิดพลาด"}</h3>
        <p className="text-gray-400 max-w-md">{chapter.errorSuggestion || "ไม่สามารถโหลดเนื้อหาของตอนนี้ได้"}</p>
        <Button onClick={onRetry} variant="secondary">ลองใหม่อีกครั้ง</Button>
      </div>
    );
  }

  const currentScene = chapter.content.scenes[currentSceneIndex];

  return (
    <div className="flex flex-col space-y-4">
      {/* Visual Container */}
      <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-800 group">
        
        {/* Modern Smart Image Component with smooth transition */}
        <SmartImage 
          src={currentScene.imageUrl} 
          alt={`Scene ${currentSceneIndex + 1}`} 
          isZoomed={isPlaying}
        />
        
        {/* Scene Indicator */}
        <div className="absolute top-4 right-4 z-20 px-3 py-1 bg-black/60 backdrop-blur rounded-full border border-white/10 text-xs text-white">
           ฉากที่ {currentSceneIndex + 1}/{chapter.content.scenes.length}
        </div>
        
        {/* Big Play Button Overlay (if paused) */}
        {!isPlaying && !isDownloading && (
          <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/20 group-hover:bg-black/40 transition-colors cursor-pointer" onClick={togglePlay}>
            <button 
              className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-lg shadow-red-900/50"
            >
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        )}

        {/* Downloading Overlay */}
        {isDownloading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-40 bg-black/80 backdrop-blur-sm">
             <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div>
             <p className="text-white font-bold">กำลังบันทึกวิดีโอ (ฉากที่ {currentSceneIndex + 1})...</p>
             <p className="text-xs text-gray-400 mt-2">กรุณารอสักครู่</p>
          </div>
        )}
      </div>

      {/* Audio Element (Hidden) */}
      <audio 
        ref={audioRef}
        src={currentScene.audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleAudioEnded}
        className="hidden"
      />

      {/* Controls */}
      <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-800 flex items-center gap-4">
        <button 
          onClick={togglePlay}
          className="text-white hover:text-red-500 transition-colors disabled:opacity-50"
          disabled={isDownloading}
        >
          {isPlaying ? (
             <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
             <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>

        {/* Progress Bar */}
        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden relative">
          <div 
            className="absolute top-0 left-0 h-full bg-red-600 transition-all duration-200"
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 font-mono hidden sm:inline">Scene {currentSceneIndex + 1}</span>
            
            <button 
                onClick={handleDownloadVideo}
                disabled={isDownloading}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded-lg border border-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="ดาวน์โหลดวิดีโอ (ฉากปัจจุบัน)"
            >
                {isDownloading ? (
                   <span className="flex items-center gap-2">Processing...</span>
                ) : (
                   <>
                     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                     </svg>
                     <span className="hidden sm:inline">ดาวน์โหลด</span>
                   </>
                )}
            </button>
        </div>
      </div>
    </div>
  );
};