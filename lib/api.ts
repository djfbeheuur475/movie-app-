// Kept for backwards compatibility — all AI calls now go direct via lib/gemini.ts
// This file is no longer used for AI or Trakt but retained to avoid import errors.
export const backendApi = {
  askGemini: async (_messages: { role: string; content: string }[]) => {
    throw new Error('Use lib/gemini.ts directly instead of backendApi.askGemini');
  },
};
