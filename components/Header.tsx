import React from 'react';

interface HeaderProps {
  onBack?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onBack }) => {
  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all ${onBack ? 'bg-black/80 backdrop-blur-md border-b border-white/10' : 'bg-transparent'}`}>
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button 
              onClick={onBack}
              className="group flex items-center gap-1.5 pl-2 pr-4 py-2 -ml-2 text-gray-400 hover:text-white transition-all rounded-full hover:bg-white/10"
              aria-label="กลับหน้าหลัก"
            >
               <i className="ph ph-arrow-left text-xl group-hover:-translate-x-1 transition-transform"></i>
               <span className="text-sm font-medium hidden sm:inline">กลับหน้าหลัก</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-700 rounded flex items-center justify-center font-bold text-lg text-white">D</div>
            <span className="font-bold text-xl tracking-wide text-white">DocuGen</span>
          </div>
        </div>
        
        {onBack ? (
            <button 
                onClick={onBack} 
                className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg shadow-red-900/20 transition-all flex items-center gap-2 border border-transparent hover:scale-105 active:scale-95 whitespace-nowrap"
            >
                <i className="ph-bold ph-plus"></i>
                <span>สร้างเรื่องใหม่</span>
            </button>
        ) : (
            <div className="px-4 py-1 rounded-full border border-gray-700 bg-gray-900/50 text-xs text-gray-400">
              Thai Educational Series
            </div>
        )}
      </div>
    </header>
  );
};