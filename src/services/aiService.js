// AI Service - Multi-Brain Support
// Powered by Naracord AI (OpenAI GPT-4o-mini default), OpenAI GPT-4o, and Google Gemini

const axios = require("axios");
const FormData = require("form-data");

// Returns: { text: string, tokensUsed: number }
async function generateAIResponse(userMessage, conversationHistory = [], systemPrompt, client, imageUrl = null, audioUrl = null) {
    let aiModel = client.aiModel || "gpt-4o-mini";
    const useManagedQuota = client.useNaracordQuota !== false;
    let aiApiKey = client.aiApiKey;

    // Use Naracord AI's managed key if user opted in
    if (useManagedQuota) {
        aiModel = "gpt-4o-mini"; // Force override to prevent Gemini/GPT-4o crash on Naracord key
        aiApiKey = process.env.OPENAI_API_KEY;
        if (!aiApiKey) {
            console.error("CRITICAL: OPENAI_API_KEY is missing in backend .env!");
            return { text: "System Configuration Error: Managed AI key is missing. Please contact support.", tokensUsed: 0 };
        }
    } else {
        // User opted to bring their own key
        if (!aiApiKey) {
            return { text: "Error: You have disabled 'Naracord AI Managed Quota' but have not provided your own API Key in the settings. Please enter your API key to continue using the bot.", tokensUsed: 0 };
        }
    }

    console.log(`Generating AI Response using model: ${aiModel} (Managed Quota: ${useManagedQuota})`);

    let userContent = userMessage;

    // For OpenAI: if audio is provided, transcribe it first via Groq Whisper (FREE)
    if (audioUrl && (aiModel === "gpt-4o-mini" || aiModel === "gpt-4o")) {
        try {
            const transcribedText = await transcribeWithWhisper(audioUrl);
            userContent = `[Voice Message Transcription]: ${transcribedText}`;
            console.log(`Groq Whisper transcription: ${transcribedText.substring(0, 100)}...`);
        } catch (whisperErr) {
            console.error("Groq Whisper transcription failed:", whisperErr.message);
            userContent = "The user sent a voice message but it could not be transcribed. Please ask them to type their message instead.";
        }
    }

    // For OpenAI: build image content array
    if (imageUrl && (aiModel === "gpt-4o-mini" || aiModel === "gpt-4o")) {
        userContent = [
            { type: "text", text: userMessage || "Please describe this image." },
            { type: "image_url", image_url: { url: imageUrl } }
        ];
    }

    const messages = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userContent }
    ];

    try {
        if (aiModel === "gpt-4o-mini" || aiModel === "gpt-4o") {
            const result = await callOpenAI(messages, aiModel, aiApiKey);
            return { text: result.text, tokensUsed: result.usage.total_tokens || 0 };
        } else if (aiModel === "gemini-flash") {
            const geminiReply = await callGeminiAI(userMessage, conversationHistory, systemPrompt, aiApiKey, imageUrl, audioUrl);
            return { text: geminiReply.text, tokensUsed: geminiReply.tokensUsed || 0 };
        } else {
            // Fallback for any unknown models
            const result = await callOpenAI(messages, "gpt-4o-mini", aiApiKey);
            return { text: result.text, tokensUsed: result.usage.total_tokens || 0 };
        }
    } catch (error) {
        console.error(`Error in AI Service (${aiModel}):`, error.response?.data || error.message);
        // Better error for invalid custom keys
        if (error.response?.status === 401 && !useManagedQuota) {
             return { text: "Error: The OpenAI API Key you provided is invalid or expired. Please update it in your settings.", tokensUsed: 0 };
        }
        return { text: "I'm sorry, I am currently facing a technical issue. Please try again later or contact support.", tokensUsed: 0 };
    }
}

// 2. Provider: OpenAI API (GPT-4o / GPT-4o Mini)
async function callOpenAI(messages, model, apiKey) {
    const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        { model, messages },
        {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            }
        }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
        return {
            text: response.data.choices[0].message.content.trim(),
            usage: response.data.usage || { total_tokens: 0 }
        };
    }
    throw new Error("Empty response from OpenAI");
}

// 2b. Groq Whisper API - Transcribe audio to text (Free & Fast)
async function transcribeWithWhisper(audioUrl) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
        throw new Error("GROQ_API_KEY is missing in .env for Whisper Audio support.");
    }

    // Parse the data URL to get raw buffer
    const matches = audioUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) throw new Error("Invalid audio data URL");

    const mimeType = matches[1];
    const audioBuffer = Buffer.from(matches[2], 'base64');

    // Determine file extension from mime type
    const extMap = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4', 'audio/wav': 'wav', 'audio/webm': 'webm' };
    const ext = extMap[mimeType] || 'ogg';

    const form = new FormData();
    form.append('file', audioBuffer, { filename: `voice.${ext}`, contentType: mimeType });
    form.append('model', 'whisper-large-v3-turbo');

    const response = await axios.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        form,
        {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${groqKey}`
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        }
    );

    if (response.data && response.data.text) {
        return response.data.text;
    }
    throw new Error("Empty response from Groq Whisper API");
}

// 3. Provider: Google Gemini API (Gemini Flash)
async function callGeminiAI(userMessage, conversationHistory, systemPrompt, apiKey, imageUrl = null, audioUrl = null) {
    // Gemini requires a different format
    const contents = [];

    // Map conversation history
    for (const msg of conversationHistory) {
        contents.push({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
        });
    }

    // Add current user message
    const userParts = [];
    if (userMessage) {
        userParts.push({ text: userMessage });
    } else if (imageUrl) {
        userParts.push({ text: "Please describe this image." });
    } else if (audioUrl) {
        userParts.push({ text: "The user sent a voice message. Please listen and respond appropriately." });
    }

    // Attach image if provided
    if (imageUrl) {
        const matches = imageUrl.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            userParts.push({
                inlineData: {
                    mimeType: matches[1],
                    data: matches[2]
                }
            });
        }
    }

    // Attach audio if provided (Gemini natively supports audio)
    if (audioUrl) {
        const matches = audioUrl.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            userParts.push({
                inlineData: {
                    mimeType: matches[1],
                    data: matches[2]
                }
            });
        }
    }

    contents.push({
        role: "user",
        parts: userParts
    });

    const payload = {
        contents,
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        }
    };

    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        payload,
        { headers: { "Content-Type": "application/json" } }
    );

    if (response.data && response.data.candidates && response.data.candidates.length > 0) {
        return {
            text: response.data.candidates[0].content.parts[0].text.trim(),
            tokensUsed: response.data.usageMetadata ? response.data.usageMetadata.totalTokenCount : 0
        };
    }
    throw new Error("Empty response from Gemini API");
}

module.exports = {
    generateAIResponse
};
