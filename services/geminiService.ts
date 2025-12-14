import { GoogleGenAI, Type, Modality } from "@google/genai";
import { OutlineResponse } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper: Retry mechanism for handling 429 Resource Exhausted errors
// Uses exponential backoff to recover from rate limits gracefully
async function retryOperation<T>(
  operation: () => Promise<T>, 
  retries = 3, 
  delay = 2000
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Enhanced check for various 429 error structures
    const isRateLimit = 
      error?.status === 429 || 
      error?.code === 429 || 
      error?.error?.code === 429 || // Check nested error object
      error?.message?.includes('429') || 
      error?.message?.includes('RESOURCE_EXHAUSTED') ||
      error?.message?.includes('quota');

    if (isRateLimit && retries > 0) {
      console.warn(`Gemini API Rate Limit hit. Retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      // Exponential backoff: multiply delay by 2
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// 1. Generate the Outline (Structure)
export const generateDocumentaryOutline = async (topic: string): Promise<OutlineResponse> => {
  // Use gemini-2.5-flash for text generation speed and reliability
  const model = "gemini-2.5-flash";
  
  const prompt = `
    Create a comprehensive documentary outline in Thai about the topic: "${topic}".
    Designed to be an educational series.
    Break it down into 8 distinct chapters to provide a detailed narrative.
    Each chapter should have a compelling title and a short summary of what will be covered.
    Return JSON only.
  `;

  return retryOperation(async () => {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("No text returned from Gemini");
      return JSON.parse(text) as OutlineResponse;
    } catch (error) {
      console.error("Error generating outline:", error);
      throw error;
    }
  });
};

// 2. Generate Content (Scenes: Script + Image Prompt)
export const generateChapterScenesScript = async (topic: string, chapterTitle: string) => {
  const model = "gemini-2.5-flash";
  const prompt = `
    You are writing a documentary script for the topic "${topic}", specifically the chapter "${chapterTitle}".
    
    Break this chapter into exactly 3 distinct scenes to create visual variety.
    
    For each scene, provide:
    1. "script": A engaging narration script in Thai (approx 60-80 words per scene).
    2. "imagePrompt": A detailed English prompt to generate a photorealistic image specifically for this scene.
    
    Output a JSON object with a "scenes" array.
  `;

  return retryOperation(async () => {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                   type: Type.OBJECT,
                   properties: {
                      script: { type: Type.STRING },
                      imagePrompt: { type: Type.STRING }
                   }
                }
              }
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("No script generated");
      return JSON.parse(text) as { scenes: { script: string; imagePrompt: string }[] };
    } catch (error) {
      console.error("Script generation error:", error);
      throw error;
    }
  });
};

// 3. Generate Image
export const generateChapterImage = async (imagePrompt: string): Promise<string> => {
  const model = "gemini-2.5-flash-image"; 
  
  return retryOperation(async () => {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: imagePrompt }] }, // Explicit text part structure
      });

      // Iterate to find the image part
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      throw new Error("No image data found in response");
    } catch (error) {
      console.error("Image gen error:", error);
      throw error; // Throw error to let the UI handle it
    }
  }, 3, 4000); // Increased retries and delay for images
};

// Helper: Create WAV Header for raw PCM data
const createWavHeader = (dataLength: number, sampleRate: number = 24000, numChannels: number = 1): Uint8Array => {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // File size
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true); // Subchunk2Size

  return new Uint8Array(buffer);
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

// 4. Generate Audio (TTS)
export const generateChapterAudio = async (script: string, voiceName: string = 'Puck'): Promise<string> => {
  // Strategy: 
  // 1. Try 'gemini-2.0-flash-exp' (Experimental) - Often most capable for multimodal output
  // 2. Try 'gemini-2.5-flash-preview-tts' (Dedicated) - Best quality if available
  // 3. Try 'gemini-2.5-flash-native-audio-preview-09-2025' (Live API preview)
  
  const modelsToTry = [
    'gemini-2.0-flash-exp',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-flash-native-audio-preview-09-2025'
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      console.log(`Attempting TTS with model: ${model}`);
      return await retryOperation(async () => {
        // Adjust prompt for conversational models to ensure they just read the text
        let textPrompt = script;
        if (!model.includes('tts')) {
            // For generative models, give explicit instruction to behave like a TTS engine
            textPrompt = `Read the following text aloud exactly as written. Do not add any introductory or concluding remarks. Do not say "Here is the audio". Text: "${script}"`;
        }

        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text: textPrompt }] }, 
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName } 
              }
            }
          }
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
           // Check if it returned text error instead (sometimes happens with incorrect config)
           const textError = response.candidates?.[0]?.content?.parts?.[0]?.text;
           if (textError) {
             console.warn(`Model ${model} returned text instead of audio:`, textError);
             throw new Error("Model returned text instead of audio: " + textError);
           }
           throw new Error("No audio data generated");
        }

        // Convert base64 to binary PCM data
        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const pcmBytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          pcmBytes[i] = binaryString.charCodeAt(i);
        }

        // Wrap PCM in WAV container (24kHz, Mono, 16-bit)
        // Note: Different models might return different sample rates, but 24kHz is standard for Gemini Audio
        const wavHeader = createWavHeader(len, 24000, 1);
        
        const wavBytes = new Uint8Array(wavHeader.length + pcmBytes.length);
        wavBytes.set(wavHeader);
        wavBytes.set(pcmBytes, wavHeader.length);

        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        return URL.createObjectURL(blob);
      }, 1, 1000); // 1 retry per model to fail fast

    } catch (error: any) {
      console.warn(`Model ${model} failed:`, error?.message || error);
      lastError = error;
      // Continue to next model
    }
  }

  throw lastError || new Error("Unable to generate audio with any available model.");
};