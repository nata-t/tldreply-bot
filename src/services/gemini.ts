import { GoogleGenAI } from '@google/genai';

export class GeminiService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async summarizeMessages(messages: Array<{
    username?: string;
    firstName?: string;
    content: string;
    timestamp: string;
  }>): Promise<string> {
    if (messages.length === 0) {
      return 'No messages found in the specified time range.';
    }

    // Format messages for context
    const formattedMessages = messages.map((msg, idx) => {
      const user = msg.username || msg.firstName || 'Unknown';
      const content = msg.content;
      return `${idx + 1}. [${user}]: ${content}`;
    }).join('\n\n');

    const prompt = `You are a helpful assistant that summarizes Telegram group chat conversations. 
    Provide a concise, well-structured summary of the following conversation.
    
    Focus on:
    - Main topics discussed
    - Key decisions or conclusions
    - Important announcements
    - Ongoing questions or unresolved issues
    - Skip greetings, emojis-only messages, and spam
    
    Keep the summary under 300 words and use bullet points if helpful.
    
    Conversation:
    ${formattedMessages}
    
    Summary:`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: prompt,
      });
      return response.text || 'Generated summary (no text returned)';
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error('Failed to generate summary. Please check your API key and try again.');
    }
  }

  static validateApiKey(apiKey: string): boolean {
    // Basic validation - Gemini API keys typically have this format
    return apiKey.length > 20 && /^[A-Za-z0-9_-]+$/.test(apiKey);
  }
}
