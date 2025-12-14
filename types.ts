export interface Chapter {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
  content?: ChapterContent;
  errorMessage?: string;
  errorSuggestion?: string;
}

export interface Scene {
  script: string;
  imagePrompt: string;
  imageUrl: string;
  audioUrl: string;
}

export interface ChapterContent {
  scenes: Scene[];
}

export enum AppState {
  IDLE = 'IDLE',
  PLANNING = 'PLANNING',
  READY = 'READY', // Outline is ready, player is visible
}

export interface OutlineResponse {
  chapters: {
    title: string;
    description: string;
  }[];
}