// AI Service - Powered by Pollinations AI (100% Free)
// Now accepts systemPrompt as parameter for multi-client support.

const axios = require("axios");

async function generateAIResponse(userMessage, conversationHistory = [], systemPrompt) {
    try {
        console.log("Generating response via Pollinations AI (100% Free)...");
        
        // Build messages array: System Prompt + Past History + Current Message
        const messages = [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: userMessage }
        ];

        const response = await axios.post(
            "https://text.pollinations.ai/",
            {
                messages,
                model: "openai" 
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        if (response.data) {
            console.log("Success with Pollinations AI");
            
            // Clean out any promotional ads or footers added by Pollinations
            let cleanResponse = response.data;
            cleanResponse = cleanResponse.replace(/---[\s\S]*$/, '').trim();
            cleanResponse = cleanResponse.replace(/\*Support Pollinations\.AI:\*[\s\S]*$/i, '').trim();
            cleanResponse = cleanResponse.replace(/🌸 \*Ad\* 🌸[\s\S]*$/i, '').trim();
            
            return cleanResponse;
        } else {
            throw new Error("Empty response from Pollinations AI");
        }

    } catch (error) {
        console.error("Error in AI Service:", error.response?.data || error.message);
        return "I'm sorry, I am currently facing a technical issue. Please try again later or contact support.";
    }
}

module.exports = {
    generateAIResponse
};
