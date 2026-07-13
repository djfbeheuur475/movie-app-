// All AI calls go directly via lib/openrouter.ts — this stub is retained to avoid import errors.
export const backendApi = {
  askAI: async (_messages: { role: string; content: string }[]) => {
    throw new Error('Use lib/openrouter.ts directly instead of backendApi.askAI');
  },
};
