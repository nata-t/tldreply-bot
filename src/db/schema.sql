-- Database schema for TLDR Bot

-- Groups table: stores group chat information and encrypted API keys
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    telegram_chat_id BIGINT UNIQUE NOT NULL,
    gemini_api_key_encrypted TEXT,
    enabled BOOLEAN DEFAULT true,
    setup_by_user_id BIGINT,
    setup_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table: caches recent messages for summarization
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    telegram_chat_id BIGINT NOT NULL REFERENCES groups(telegram_chat_id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL,
    user_id BIGINT,
    username TEXT,
    first_name TEXT,
    content TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(telegram_chat_id, message_id)
);

-- Index for faster message retrieval
CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp 
ON messages(telegram_chat_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_messages_chat_message 
ON messages(telegram_chat_id, message_id);

-- Note: group_settings table removed - using hardcoded values for simplicity
-- Messages are cached for 48 hours before automatic deletion
