import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { LookMetrics } from "../types";

const getAiClient = () => {
  // Legge la chiave direttamente dal processo globale, che viene aggiornato dal selettore Pro
  const apiKey = (window as any).process?.env?.API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey });
};

const parseDataUrl = (dataUrl: string) => {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches || matches.length < 3) {
    throw new Error("Invalid Data URL format");
  }
  return { mimeType: matches[1], data: matches[2] };
};

const blendImages = (originalDataUrl: string, styledDataUrl: string, opacity: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (opacity >= 100) { resolve(styledDataUrl); return; }
    if (opacity <= 0) { resolve(originalDataUrl); return; }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error("Could not get canvas context")); return; }

    const imgOriginal = new Image();
    const imgStyled = new Image();
    let loadedCount = 0;
    const checkLoaded = () => {
        loadedCount++;
        if (loadedCount === 2) {
            canvas.width = imgOriginal.naturalWidth;
            canvas.height = imgOriginal.naturalHeight;
            ctx.drawImage(imgOriginal, 0, 0);
            ctx.globalAlpha = opacity / 100;
            ctx.drawImage(imgStyled, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        }
    };
    imgOriginal.onload = checkLoaded;
    imgStyled.onload = checkLoaded;
    imgOriginal.src = originalDataUrl;
    imgStyled.src = styledDataUrl;
  });
};

export const analyzeLookMetrics = async (dataUrlOrBase64: string): Promise<LookMetrics> => {
  const ai = getAiClient();
  let mimeType = "image/jpeg";
  let data = dataUrlOrBase64;

  if (dataUrlOrBase64.startsWith("data:")) {
      const parsed = parseDataUrl(dataUrlOrBase64);
      mimeType = parsed.mimeType;
      data = parsed.data;
  }
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType, data } }, 
          { text: "Analyze contrast, saturation, warmth, uniformity, exposure (0-100) as JSON." }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            contrast: { type: Type.INTEGER },
            saturation: { type: Type.INTEGER },
            warmth: { type: Type.INTEGER },
            uniformity: { type: Type.INTEGER },
            exposure: { type: Type.INTEGER },
          },
          required: ["contrast", "saturation", "warmth", "uniformity", "exposure"]
        }
      }
    });

    return JSON.parse(response.text || "{}") as LookMetrics;
  } catch (error: any) {
    const msg = error.message || "";
    if (msg.includes("429") || msg.includes("quota")) throw new Error("QUOTA_EXCEEDED");
    throw error;
  }
};

export const applyLookTransfer = async (
  referenceDataUrl: string, 
  targetDataUrl: string,
  intensity: number,
  preset: string
): Promise<string> => {
  const ai = getAiClient();
  const ref = parseDataUrl(referenceDataUrl);
  const target = parseDataUrl(targetDataUrl);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: {
        parts: [
          { text: `Apply ${preset} style from reference to target. Return image.` },
          { text: "Target:" },
          { inlineData: { mimeType: target.mimeType, data: target.data } }, 
          { text: "Reference:" },
          { inlineData: { mimeType: ref.mimeType, data: ref.data } }
        ]
      },
      config: {
        imageConfig: { aspectRatio: "1:1" },
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]
      }
    });

    let generatedBase64 = null;
    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.data) {
                generatedBase64 = `data:image/png;base64,${part.inlineData.data}`;
                break;
            }
        }
    }
    
    if (generatedBase64) {
        return await blendImages(targetDataUrl, generatedBase64, intensity);
    }
    throw new Error("No image generated");

  } catch (error: any) {
    const msg = error.message || "";
    if (msg.includes("429") || msg.includes("quota")) throw new Error("QUOTA_EXCEEDED");
    if (msg.includes("not found")) throw new Error("KEY_INVALID");
    throw error;
  }
};