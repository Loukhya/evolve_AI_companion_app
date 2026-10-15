const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODERATION_MODEL = 'meta-llama/llama-guard-4-12b';

function getApiKey(): string {
    const key = (import.meta as any).env?.VITE_GROQ_API_KEY;
    if (!key || key.includes('REPLACE')) {
        throw new Error('API Key missing or invalid. Check .env file.');
    }
    return key;
}

/**
 * Checks if a user's message is safe using Groq's Llama Guard 3.
 * Returns true if safe, false if the message contains self-harm, hate, violence, etc.
 */
export async function checkIfMessageIsSafe(message: string): Promise<boolean> {
    // If the message is completely empty, it is technically "safe" 
    if (!message || message.trim() === '') return true;

    const apiKey = getApiKey();

    try {
        const res = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODERATION_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: message
                    }
                ],
                max_tokens: 10,
                temperature: 0.1 // Keep it deterministic
            }),
        });

        if (!res.ok) {
            console.error(`[Moderation] API error ${res.status}`);
            // If the moderation API fails (e.g., rate limit), default to safe to not break the app completely,
            // or default to false depending on strictness. We'll default to true for UX.
            return true;
        }

        const data = await res.json();
        const responseText = data.choices?.[0]?.message?.content || '';

        // Llama Guard typically responds with exactly "safe" or "unsafe" + reasoning
        return !responseText.toLowerCase().includes('unsafe');
    } catch (err) {
        console.error('[Moderation] Request failed:', err);
        return true;
    }
}
