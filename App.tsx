import React, { useState, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { Button } from './components/Button';
import { Player } from './components/Player';
import { Chapter, AppState, Scene } from './types';
import * as GeminiService from './services/geminiService';

const App: React.FC = () => {
  const [topic, setTopic] = useState('');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck'); // Default: Formal (Puck)
  
  // Voice Preview State
  const [previewState, setPreviewState] = useState<{ id: string, status: 'loading' | 'playing' } | null>(null);
  const voiceCache = useRef<Record<string, string>>({});
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  
  const playlistRef = useRef<HTMLDivElement>(null);

  // Helper: Handle Voice Preview
  const handlePreviewVoice = async (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation(); // Prevent selection when clicking play

    if (previewState?.id === voiceId) {
      previewAudioRef.current?.pause();
      setPreviewState(null);
      return;
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }

    setPreviewState({ id: voiceId, status: 'loading' });

    try {
      let url = voiceCache.current[voiceId];

      if (!url) {
        const textMap: Record<string, string> = {
          'Puck': 'สวัสดีครับ ยินดีต้อนรับสู่ DocuGen สาระคดีเพื่อการเรียนรู้',
          'Zephyr': 'สวัสดีค่ะ ขอให้เพลิดเพลินกับเรื่องราวที่น่าสนใจนะคะ',
          'Kore': 'สวัสดีครับ! พร้อมที่จะไปเปิดโลกกว้างกับเราหรือยัง!',
          'Charon': 'สวัสดี... มาร่วมค้นหาคำตอบของปริศนานี้ไปด้วยกัน'
        };
        const sampleText = textMap[voiceId] || "ทดสอบเสียงบรรยาย";
        
        url = await GeminiService.generateChapterAudio(sampleText, voiceId);
        voiceCache.current[voiceId] = url;
      }

      const audio = new Audio(url);
      previewAudioRef.current = audio;
      
      audio.onended = () => setPreviewState(null);
      audio.onerror = () => setPreviewState(null);

      setPreviewState({ id: voiceId, status: 'playing' });
      await audio.play();

    } catch (err) {
      console.error("Preview failed:", err);
      setPreviewState(null);
    }
  };

  // 1. Generate Outline
  const handleCreateOutline = async () => {
    if (!topic.trim()) return;
    
    if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        setPreviewState(null);
    }

    setAppState(AppState.PLANNING);
    setError(null);

    try {
      const outline = await GeminiService.generateDocumentaryOutline(topic);
      
      setAppState(prevState => {
        if (prevState !== AppState.PLANNING) return prevState;

        const newChapters: Chapter[] = outline.chapters.map((c, index) => ({
          id: `ch-${Date.now()}-${index}`,
          title: c.title,
          description: c.description,
          status: 'pending'
        }));
        
        setChapters(newChapters);
        
        if (newChapters.length > 0) {
          setCurrentChapterId(newChapters[0].id);
          setTimeout(() => generateChapterContent(newChapters[0]), 0);
        }
        
        return AppState.READY;
      });

    } catch (e) {
      setAppState(prevState => {
        if (prevState !== AppState.PLANNING) return prevState;
        setError("ไม่สามารถสร้างโครงเรื่องได้ กรุณาลองใหม่อีกครั้ง");
        return AppState.IDLE;
      });
    }
  };

  // 2. Generate Chapter Content (On Demand)
  const generateChapterContent = async (chapter: Chapter) => {
    if (chapter.status === 'ready' || chapter.status === 'generating') return;

    setChapters(prev => prev.map(c => c.id === chapter.id ? { 
      ...c, 
      status: 'generating', 
      errorMessage: undefined, 
      errorSuggestion: undefined 
    } : c));

    try {
      // Step A: Script & Image Prompts for Scenes
      let scenesData: { script: string; imagePrompt: string }[] = [];
      try {
        const result = await GeminiService.generateChapterScenesScript(topic, chapter.title);
        scenesData = result.scenes;
      } catch (err) {
        throw new Error("SCRIPT_ERROR");
      }
      
      // Step B: Generate Image & Audio for each Scene (Sequentially)
      const finishedScenes: Scene[] = [];
      
      for (const sceneData of scenesData) {
        // Generate Image
        let imageUrl = "";
        try {
          imageUrl = await GeminiService.generateChapterImage(sceneData.imagePrompt);
        } catch (err) {
          console.error("Image error for scene, using placeholder logic if needed or fail");
          throw new Error("IMAGE_ERROR");
        }

        // Small delay
        await new Promise(r => setTimeout(r, 500));

        // Generate Audio
        let audioUrl = "";
        try {
          audioUrl = await GeminiService.generateChapterAudio(sceneData.script, selectedVoice);
        } catch (err) {
          throw new Error("AUDIO_ERROR");
        }

        finishedScenes.push({
            script: sceneData.script,
            imagePrompt: sceneData.imagePrompt,
            imageUrl,
            audioUrl
        });
        
        // Optional: Update state partially here if we wanted streaming updates, 
        // but for simplicity we wait for all 3 scenes to finish.
      }

      setChapters(prev => prev.map(c => c.id === chapter.id ? {
        ...c,
        status: 'ready',
        content: { scenes: finishedScenes }
      } : c));

    } catch (e: any) {
      console.error(e);
      let errorMessage = "เกิดข้อผิดพลาดในการสร้างเนื้อหา";
      let errorSuggestion = "กรุณาลองกด 'ลองใหม่อีกครั้ง'";

      if (e.message === "SCRIPT_ERROR") {
          errorMessage = "ไม่สามารถสร้างบทบรรยายได้";
          errorSuggestion = "ระบบ AI อาจมีปัญหาในการประมวลผลหัวข้อนี้";
      } else if (e.message === "IMAGE_ERROR") {
          errorMessage = "ไม่สามารถสร้างภาพประกอบได้";
          errorSuggestion = "คำบรรยายภาพอาจซับซ้อนเกินไป";
      } else if (e.message === "AUDIO_ERROR") {
          errorMessage = "ไม่สามารถสร้างเสียงบรรยายได้";
          errorSuggestion = "ระบบแปลงเสียงอาจขัดข้องชั่วคราว (Rate Limit)";
      }

      setChapters(prev => prev.map(c => c.id === chapter.id ? { 
          ...c, 
          status: 'error',
          errorMessage,
          errorSuggestion
      } : c));
    }
  };

  const handlePlayChapter = useCallback((chapter: Chapter) => {
    setCurrentChapterId(chapter.id);
    if (!chapter.content) {
      generateChapterContent(chapter);
    }
    if (window.innerWidth < 1024) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [topic, selectedVoice]);

  const handleChapterEnd = () => {
    const currentIndex = chapters.findIndex(c => c.id === currentChapterId);
    if (currentIndex >= 0 && currentIndex < chapters.length - 1) {
      const nextChapter = chapters[currentIndex + 1];
      handlePlayChapter(nextChapter);
    }
  };

  const handleBack = () => {
    if (appState === AppState.PLANNING) {
        setAppState(AppState.IDLE);
        setChapters([]);
        setCurrentChapterId(null);
        setTopic('');
        return;
    }

    if (window.confirm("คุณต้องการกลับไปหน้าแรกและเริ่มสร้างเรื่องใหม่ใช่หรือไม่? ข้อมูลปัจจุบันจะหายไป")) {
        setAppState(AppState.IDLE);
        setChapters([]);
        setCurrentChapterId(null);
        setTopic('');
    }
  };

  const scrollToPlaylist = () => {
    playlistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const activeChapter = chapters.find(c => c.id === currentChapterId);

  const loadingStyles = `
    @keyframes playlist-loading {
      0% { left: -50%; }
      100% { left: 100%; }
    }
  `;

  const voiceOptions = [
    { id: 'Puck', label: 'ทางการ', icon: 'ph-microphone-stage', color: 'red' },
    { id: 'Zephyr', label: 'นุ่มนวล', icon: 'ph-heart', color: 'gray' },
    { id: 'Kore', label: 'ตื่นเต้น', icon: 'ph-lightning', color: 'gray' },
    { id: 'Charon', label: 'ลึกลับ', icon: 'ph-ghost', color: 'gray' }
  ];

  return (
    <div className={`min-h-screen ${appState === AppState.IDLE ? 'flex flex-col' : 'pb-20'}`}>
      <style>{loadingStyles}</style>
      
      {appState === AppState.IDLE && (
         <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-full h-64 bg-red-900/20 blur-[100px] rounded-full pointer-events-none"></div>
      )}

      <Header onBack={appState !== AppState.IDLE ? handleBack : undefined} />
      
      {appState === AppState.IDLE ? (
        <main className="flex-grow flex flex-col justify-center items-center px-4 relative z-10 max-w-2xl mx-auto w-full text-center mt-[-4rem]">
          <div className="mb-8">
            <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-2">
                สร้างสาระคดีระดับโลก
            </h1>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight">
                <span className="text-gradient">ด้วยพลัง AI ใน 1 คลิก</span>
            </h1>
          </div>

          <div className="w-full space-y-5 bg-[#0a0c10]/80 p-6 md:p-8 rounded-3xl border border-gray-800 backdrop-blur-sm shadow-2xl">
            
            <div className="text-left">
                <label className="text-gray-400 text-sm ml-1 mb-2 block font-light">หัวข้อสารคดี</label>
                <input 
                   type="text" 
                   value={topic}
                   onChange={(e) => setTopic(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleCreateOutline()}
                   placeholder="เช่น สงครามโลกครั้งที่ 2, ชีวิตปลาวาฬ, ความลับของปิรามิด" 
                   className="w-full bg-[#11141c] border border-gray-800 px-5 py-4 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all text-lg"
                />
            </div>

            <div className="text-left">
                <label className="text-gray-400 text-sm ml-1 mb-2 block font-light">เลือกเสียงบรรยาย</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {voiceOptions.map((voice) => {
                       const isActive = selectedVoice === voice.id;
                       const isPreviewing = previewState?.id === voice.id;
                       
                       return (
                         <div 
                           key={voice.id}
                           onClick={() => setSelectedVoice(voice.id)}
                           className={`cursor-pointer border rounded-xl p-3 flex flex-col items-center justify-center gap-2 relative group transition-all duration-200 hover:-translate-y-0.5 ${
                             isActive 
                               ? 'border-red-500 bg-red-900/20' 
                               : 'border-gray-700 bg-[#11141c] hover:border-gray-500'
                           }`}
                         >
                            <div className="absolute top-2 left-2 z-20">
                                <button
                                    onClick={(e) => handlePreviewVoice(e, voice.id)}
                                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-lg ${
                                        isPreviewing 
                                            ? 'bg-white text-red-600 scale-110' 
                                            : 'bg-gray-800/80 text-white hover:bg-red-600 hover:scale-110'
                                    } border border-white/10`}
                                    title="ฟังเสียงตัวอย่าง"
                                >
                                    {isPreviewing ? (
                                        previewState.status === 'loading' ? (
                                            <svg className="animate-spin w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                        ) : (
                                            <i className="ph-fill ph-stop text-sm"></i>
                                        )
                                    ) : (
                                        <i className="ph-fill ph-play text-sm ml-0.5"></i>
                                    )}
                                </button>
                            </div>

                            <i className={`ph ${voice.icon} text-2xl mt-1 ${isActive ? 'text-red-400' : 'text-gray-400 group-hover:text-white'}`}></i>
                            <span className={`text-sm font-medium ${isActive ? 'text-gray-200' : 'text-gray-400 group-hover:text-white'}`}>
                              {voice.label}
                            </span>
                            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full transition-all ${
                              isActive ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-transparent'
                            }`}></div>
                         </div>
                       );
                    })}
                </div>
            </div>

            <button 
                onClick={handleCreateOutline}
                disabled={!topic.trim()}
                className="w-full mt-4 bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600 hover:to-red-800 text-white font-semibold py-4 rounded-xl shadow-lg shadow-red-900/40 transform transition hover:scale-[1.01] duration-200 text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <i className="ph-bold ph-play-circle text-xl"></i>
                เริ่มสร้างสาระคดี
            </button>
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>

          <footer className="mt-8 text-center text-gray-700 text-xs">
             Powered by Advanced AI Model
          </footer>
        </main>
      ) : (
        <main className="pt-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {appState === AppState.PLANNING && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
              <div className="relative">
                <div className="w-20 h-20 border-t-4 border-b-4 border-red-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center font-bold text-white text-xl">AI</div>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-white animate-pulse">กำลังวางโครงเรื่อง...</h2>
                <p className="text-gray-400">Gemini กำลังวิเคราะห์ข้อมูลและออกแบบบทสาระคดีเกี่ยวกับ "{topic}"</p>
              </div>
            </div>
          )}

          {appState === AppState.READY && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                {activeChapter ? (
                  <Player 
                    topic={topic}
                    chapter={activeChapter} 
                    onEnded={handleChapterEnd}
                    onRetry={() => handlePlayChapter(activeChapter)}
                  />
                ) : (
                  <div className="aspect-video bg-gray-900 rounded-xl border border-gray-800 flex items-center justify-center text-gray-500">
                    เลือกตอนเพื่อเริ่มเล่น
                  </div>
                )}
                
                <div className="bg-gray-900/30 p-6 rounded-xl border border-gray-800">
                  <h1 className="text-2xl font-bold text-white mb-2 font-serif">{topic}</h1>
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                     <span>{chapters.length} ตอน</span>
                     <span>•</span>
                     <span>บรรยายโดย: {voiceOptions.find(v => v.id === selectedVoice)?.label || 'AI'}</span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1" ref={playlistRef}>
                <div className="bg-gray-900/30 rounded-xl border border-gray-800 overflow-hidden sticky top-24 max-h-[calc(100vh-8rem)] flex flex-col">
                  <div className="p-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur flex justify-between items-center">
                    <h3 className="font-bold text-white">เนื้อหาทั้งหมด</h3>
                    <span className="text-xs text-gray-500">{chapters.filter(c => c.status === 'ready').length} / {chapters.length} พร้อมใช้งาน</span>
                  </div>
                  <div className="overflow-y-auto p-2 space-y-2">
                    {chapters.map((chapter, index) => {
                      const isActive = currentChapterId === chapter.id;
                      const isGenerating = chapter.status === 'generating';
                      const isReady = chapter.status === 'ready';
                      const isError = chapter.status === 'error';
                      
                      return (
                        <div 
                          key={chapter.id}
                          onClick={() => handlePlayChapter(chapter)}
                          className={`p-4 rounded-lg cursor-pointer transition-all border relative overflow-hidden group ${
                            isActive 
                              ? 'bg-red-600/10 border-red-600/50 shadow-sm shadow-red-900/20' 
                              : isGenerating
                                ? 'bg-yellow-900/10 border-yellow-500/30'
                                : 'bg-gray-800/20 border-transparent hover:bg-gray-800/40 hover:border-gray-700'
                          }`}
                        >
                          {isGenerating && (
                             <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-800/50 overflow-hidden">
                                <div 
                                  className="absolute top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-red-500 to-transparent"
                                  style={{ animation: 'playlist-loading 1.5s infinite linear' }}
                                />
                             </div>
                          )}

                          <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 transition-colors ${
                              isActive ? 'bg-red-600 text-white' : 
                              isGenerating ? 'bg-yellow-900/50 text-yellow-500' :
                              'bg-gray-700 text-gray-300'
                            }`}>
                              {isGenerating ? (
                                  <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                              ) : (
                                  index + 1
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <h4 className={`text-sm font-semibold truncate transition-colors ${
                                  isActive ? 'text-red-400' : 
                                  isGenerating ? 'text-yellow-400' :
                                  'text-gray-200'
                              }`}>
                                {chapter.title}
                              </h4>
                              <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                                {isGenerating ? <span className="text-yellow-500/70 animate-pulse">กำลังสร้างเนื้อหา...</span> : chapter.description}
                              </p>
                            </div>
                            
                            <div className="flex-shrink-0 self-center pl-2">
                              {isReady && <i className="ph-bold ph-check text-green-500 opacity-80"></i>}
                              {isError && <i className="ph-bold ph-warning text-red-500"></i>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-lg border-t border-gray-800 p-4 lg:hidden z-40 flex items-center justify-between safe-area-bottom">
                <div className="flex flex-col">
                   <span className="text-xs text-gray-400">กำลังเล่น</span>
                   <span className="text-sm font-bold text-white truncate max-w-[200px]">
                      {activeChapter?.title || "ยังไม่ได้เลือก"}
                   </span>
                </div>
                <button 
                  onClick={scrollToPlaylist}
                  className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors"
                >
                  <i className="ph-bold ph-list-dashes text-red-500"></i>
                  ดูรายการ
                </button>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
};

export default App;