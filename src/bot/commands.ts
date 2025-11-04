import { Bot, Context, InlineKeyboard } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';
import { Database } from '../db/database';
import { EncryptionService } from '../utils/encryption';
import { GeminiService } from '../services/gemini';

type MyContext = ConversationFlavor<Context>;

export class Commands {
  private db: Database;
  private encryption: EncryptionService;
  private bot: Bot<MyContext>;
  private setupState: Map<number, number> = new Map(); // userId -> chatId

  constructor(bot: Bot<MyContext>, db: Database, encryption: EncryptionService) {
    this.bot = bot;
    this.db = db;
    this.encryption = encryption;
    this.setupCommands();
  }

  private setupCommands() {
    // Private chat commands
    this.bot.command('start', this.handleStart.bind(this));
    this.bot.command('setup_group', this.handleSetupGroup.bind(this));
    this.bot.command('list_groups', this.handleListGroups.bind(this));
    this.bot.command('remove_group', this.handleRemoveGroup.bind(this));
    this.bot.command('continue_setup', this.handleContinueSetup.bind(this));

    // Group chat commands
    this.bot.command('setup', this.handleSetup.bind(this));
    this.bot.command('tldr', this.handleTLDR.bind(this));
    this.bot.command('tldr_info', this.handleTLDRInfo.bind(this));

    // Button handlers
    this.bot.callbackQuery('command_setup_group', this.handleButtonSetup.bind(this));
    this.bot.callbackQuery('command_list_groups', this.handleButtonList.bind(this));
    this.bot.callbackQuery('command_help', this.handleButtonHelp.bind(this));
    this.bot.callbackQuery('command_back', this.handleButtonBack.bind(this));
    this.bot.callbackQuery('command_continue_setup', async (ctx: MyContext) => {
      await ctx.answerCallbackQuery();
      await this.handleContinueSetup(ctx);
    });

    // Message handler for caching
    this.bot.on('message', this.handleMessageCache.bind(this));
  }

  private async handleStart(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat) return;

    if (chat.type === 'private') {
      // Check if user has a pending group setup
      try {
        const pendingGroups = await this.db.query(
          'SELECT telegram_chat_id FROM groups WHERE setup_by_user_id = $1 AND gemini_api_key_encrypted IS NULL ORDER BY setup_at DESC LIMIT 1',
          [chat.id]
        );

        if (pendingGroups.rows.length > 0) {
          const groupChatId = pendingGroups.rows[0].telegram_chat_id;
          const keyboard = new InlineKeyboard()
            .text('🔑 Continue Setup', 'command_continue_setup')
            .text('📋 List Groups', 'command_list_groups');

          await ctx.reply(
            `👋 Welcome back!\n\n` +
            `⚠️ You have a pending group setup (Chat ID: <code>${groupChatId}</code>)\n\n` +
            `Please provide your Gemini API key to complete the setup.\n\n` +
            `Run /continue_setup to provide your API key.`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboard
            }
          );
          return;
        }
      } catch (error) {
        console.error('Error checking pending setups:', error);
      }

      const keyboard = new InlineKeyboard()
        .text('📝 Setup Group', 'command_setup_group')
        .text('📋 List Groups', 'command_list_groups')
        .row()
        .url('🔑 Get API Key', 'https://makersuite.google.com/app/apikey')
        .text('ℹ️ Help', 'command_help');

      await ctx.reply(
        `👋 Welcome to TLDR Bot!\n\n` +
        `This bot helps summarize Telegram group chats using Google's Gemini AI.\n\n` +
        `🔒 <b>Privacy:</b> Messages are cached for up to 48 hours and automatically deleted.\n\n` +
        `<i>Use the buttons below or type commands to get started!</i>\n\n` +
        `<b>💡 Tip:</b> You can run /setup directly in your group to start setup!`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );
    }
  }

  private async handleSetup(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat) return;

    // Only work in groups
    if (chat.type === 'private') {
      await ctx.reply(
        '❌ This command should be used in a group chat.\n\n' +
        '<b>Alternative:</b> Use /setup_group in private chat to setup by username or chat ID.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (chat.type !== 'group' && chat.type !== 'supergroup') {
      await ctx.reply('❌ This command can only be used in group chats.');
      return;
    }

    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Could not identify user.');
      return;
    }

    try {
      // Check if group already exists and is configured
      const existingGroup = await this.db.getGroup(chat.id);
      if (existingGroup && existingGroup.gemini_api_key_encrypted) {
        await ctx.reply(
          '✅ This group is already configured!\n\n' +
          'You can use /tldr to get summaries.\n' +
          'Run /tldr_info for more details.'
        );
        return;
      }

      // Create or update group entry linked to this user
      await this.db.createGroup(chat.id, userId);

      const groupName = 'title' in chat ? chat.title : 'this group';

      await ctx.reply(
        `✅ <b>Setup started for "${groupName}"!</b>\n\n` +
        `<b>Next steps:</b>\n` +
        `1. Open a private chat with me (@${ctx.me.username})\n` +
        `2. Run /continue_setup\n` +
        `3. Provide your Gemini API key\n\n` +
        `<i>💡 The group ID has been automatically detected. No need to find it manually!</i>\n\n` +
        `<i>Get your API key: https://makersuite.google.com/app/apikey</i>`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );
    } catch (error) {
      console.error('Error setting up group:', error);
      await ctx.reply('❌ Error starting setup. Please try again.');
    }
  }

  private async handleContinueSetup(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat || chat.type !== 'private') {
      await ctx.reply('❌ This command can only be used in private chat.');
      return;
    }

    try {
      // Check for pending group setup
      const pendingGroups = await this.db.query(
        'SELECT telegram_chat_id FROM groups WHERE setup_by_user_id = $1 AND gemini_api_key_encrypted IS NULL ORDER BY setup_at DESC LIMIT 1',
        [chat.id]
      );

      if (pendingGroups.rows.length === 0) {
        await ctx.reply(
          '❌ No pending group setup found.\n\n' +
          '<b>To start setup:</b>\n' +
          '• Run /setup in your group (easiest!)\n' +
          '• Or run /setup_group in private chat',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const groupChatId = pendingGroups.rows[0].telegram_chat_id;

      // Verify the group still exists and bot is in it
      try {
        const chatInfo = await ctx.api.getChat(groupChatId);
        const groupName = 'title' in chatInfo ? chatInfo.title : `Group ${groupChatId}`;

        await ctx.reply(
          `✅ Found pending setup for: <b>${groupName}</b>\n\n` +
          `Please paste your Gemini API key to complete the setup.\n\n` +
          `<i>Get your API key from:</i>\n` +
          `https://makersuite.google.com/app/apikey\n\n` +
          `<b>🔒 Security:</b> Your API key will be encrypted and only used for this group.`,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }
        );

        await ctx.conversation.enter('setupApiKey');
      } catch (error) {
        await ctx.reply(
          '❌ Could not access the group. Please make sure:\n' +
          '• The bot is still in the group\n' +
          '• The group exists\n\n' +
          'Try running /setup in your group again.'
        );
      }
    } catch (error) {
      console.error('Error continuing setup:', error);
      await ctx.reply('❌ Error. Please try again.');
    }
  }

  private async handleSetupGroup(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat || chat.type !== 'private') {
      await ctx.reply('❌ This command can only be used in private chat.');
      return;
    }

    const args = ctx.message?.text?.split(' ') || [];
    if (args.length < 2) {
      await ctx.reply(
        '❌ Usage:\n\n' +
        '<b>For public groups (with @username):</b>\n' +
        '<code>/setup_group @group_username</code>\n\n' +
        '<b>For private groups (no @username):</b>\n' +
        '<code>/setup_group &lt;chat_id&gt;</code>\n\n' +
        '<i>To get the chat ID for a private group:</i>\n' +
        '1. Add @userinfobot to your group\n' +
        '2. Forward any message from your group to @userinfobot\n' +
        '3. It will reply with the chat ID (looks like: <code>-123456789</code>)\n' +
        '4. Use that ID: <code>/setup_group -123456789</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const groupInput = args[1].replace('@', '');

    try {
      let chatInfo;
      const isPrivateGroup = /^-?\d+$/.test(groupInput);

      // Check if it's a numeric ID (private group) or username (public group)
      if (isPrivateGroup) {
        // Numeric ID - private group
        const chatId = parseInt(groupInput, 10);

        // Verify bot is in the group by trying to get chat info
        chatInfo = await ctx.api.getChat(chatId);

        // Additional verification: check if it's actually a group/supergroup
        if (chatInfo.type !== 'supergroup' && chatInfo.type !== 'group') {
          await ctx.reply(
            '❌ Invalid chat type. Please make sure you\'re using a group chat ID, not a private chat ID.\n\n' +
            '<b>Private group chat IDs</b> are negative numbers (e.g., <code>-123456789</code>).',
            { parse_mode: 'HTML' }
          );
          return;
        }
      } else {
        // Username - public group
        chatInfo = await ctx.api.getChat(`@${groupInput}`);
      }

      if (chatInfo.type === 'supergroup' || chatInfo.type === 'group') {
        // Verify the bot can actually access this group
        // (getChat will fail if bot is not a member, which is good)

        // Check if group already exists
        const existingGroup = await this.db.getGroup(chatInfo.id);
        if (existingGroup && existingGroup.gemini_api_key_encrypted) {
          await ctx.reply(
            '⚠️ This group is already configured!\n\n' +
            'If you want to update the API key, please use /remove_group first, then set it up again.',
            { parse_mode: 'HTML' }
          );
          return;
        }

        await this.db.createGroup(chatInfo.id, chat.id);
        this.setupState.set(chat.id, chatInfo.id);

        const groupName = 'title' in chatInfo ? chatInfo.title : `Group ${chatInfo.id}`;

        await ctx.reply(
          `✅ Group "<b>${groupName}</b>" found!\n\n` +
          `Please provide your Gemini API key in the next message.\n\n` +
          `<i>You can get your API key from:</i>\n` +
          `https://makersuite.google.com/app/apikey\n\n` +
          `<b>🔒 Security:</b> Your API key will be encrypted and only used for this group.`,
          { parse_mode: 'HTML' }
        );
        // Store temporary state for API key input
        await ctx.conversation.enter('setupApiKey');
      } else {
        await ctx.reply('❌ Invalid group type. Please provide a valid group or supergroup.');
      }
    } catch (error: any) {
      console.error('Error setting up group:', error);

      const isPrivateGroup = /^-?\d+$/.test(args[1]?.replace('@', '') || '');

      if (isPrivateGroup) {
        // Private group specific error
        await ctx.reply(
          '❌ <b>Could not access the private group.</b>\n\n' +
          '<b>Please verify:</b>\n' +
          '1. ✅ The bot is added to your private group\n' +
          '2. ✅ You used the correct chat ID (negative number like <code>-123456789</code>)\n' +
          '3. ✅ The bot has necessary permissions in the group\n\n' +
          '<b>To get the chat ID:</b>\n' +
          '1. Add @userinfobot to your group\n' +
          '2. Forward any message from your group to @userinfobot\n' +
          '3. Copy the chat ID it provides\n' +
          '4. Make sure the bot is in the group before running /setup_group',
          { parse_mode: 'HTML' }
        );
      } else {
        // Public group specific error
        await ctx.reply(
          '❌ <b>Could not find the public group.</b>\n\n' +
          '<b>Please verify:</b>\n' +
          '1. ✅ The group has a public @username\n' +
          '2. ✅ You spelled the username correctly (case-sensitive)\n' +
          '3. ✅ The bot is added to the group\n\n' +
          '<i>Example: /setup_group @mygroup</i>',
          { parse_mode: 'HTML' }
        );
      }
    }
  }

  private async handleApiKeyInput(ctx: MyContext) {
    // This will be handled by the conversation handler
  }

  private async handleButtonSetup(ctx: MyContext) {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '📝 <b>Setup a Group</b>\n\n' +
      '<b>✨ Easiest Method (Recommended):</b>\n' +
      '1. Add the bot to your group\n' +
      '2. Run <code>/setup</code> directly in the group\n' +
      '3. Follow the prompts to provide your API key\n\n' +
      '<b>Alternative Method:</b>\n' +
      '<b>For public groups:</b>\n' +
      '<code>/setup_group @your_group_username</code>\n\n' +
      '<b>For private groups:</b>\n' +
      '<code>/setup_group &lt;chat_id&gt;</code>\n' +
      '(Get chat ID by forwarding a message to @userinfobot)',
      { parse_mode: 'HTML' }
    );
  }

  private async handleButtonList(ctx: MyContext) {
    await ctx.answerCallbackQuery();
    await this.handleListGroups(ctx);
  }

  private async handleButtonHelp(ctx: MyContext) {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .url('📚 Full Documentation', 'https://makersuite.google.com/app/apikey')
      .row()
      .text('⬅️ Back', 'command_back');

    await ctx.reply(
      'ℹ️ <b>TLDR Bot Help</b>\n\n' +
      '<b>Private Chat Commands:</b>\n' +
      '• /setup_group - Configure a group (manual method)\n' +
      '• /continue_setup - Complete a pending setup\n' +
      '• /list_groups - List your groups\n' +
      '• /remove_group - Remove a group\n\n' +
      '<b>Group Chat Commands:</b>\n' +
      '• /setup - Start setup (easiest method!)\n' +
      '• /tldr [1h|6h|day|week] - Get summary\n' +
      '• Reply with /tldr - Summarize from that message\n' +
      '• /tldr_info - Show group configuration\n\n' +
      '<i>💡 Tip: Run /setup directly in your group - no need to find chat IDs!</i>\n\n' +
      '<i>Note: Each group needs a Gemini API key.</i>',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  }

  private async handleButtonBack(ctx: MyContext) {
    await ctx.answerCallbackQuery();
    await this.handleStart(ctx);
  }

  private async handleListGroups(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat || chat.type !== 'private') return;

    try {
      const groups = await this.db.listGroupsForUser(chat.id);

      if (groups.length === 0) {
        await ctx.reply('📭 You have not configured any groups yet.\n\nUse /setup_group to get started!');
        return;
      }

      let message = '📋 Your configured groups:\n\n';
      groups.forEach((group, idx) => {
        const status = group.gemini_api_key_encrypted ? '✅ Configured' : '⏳ Pending setup';
        message += `${idx + 1}. Group ID: ${group.telegram_chat_id} ${status}\n`;
      });

      await ctx.reply(message);
    } catch (error) {
      console.error('Error listing groups:', error);
      await ctx.reply('❌ Error retrieving groups.');
    }
  }

  private async handleRemoveGroup(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat || chat.type !== 'private') {
      await ctx.reply('❌ This command can only be used in private chat.');
      return;
    }

    // TODO: Implement group removal
    await ctx.reply('⏳ Feature coming soon!');
  }

  private async handleTLDR(ctx: MyContext) {
    const chat = ctx.chat;
    let loadingMsg: any = null;

    if (!chat || chat.type === 'private') {
      await ctx.reply('❌ This command can only be used in a group.');
      return;
    }

    try {
      // Check if group is configured
      const group = await this.db.getGroup(chat.id);

      if (!group || !group.gemini_api_key_encrypted) {
        await ctx.reply(
          '❌ This group is not configured yet.\n\n' +
          'Ask an admin to set it up in private chat using /setup_group.'
        );
        return;
      }

      if (!group.enabled) {
        await ctx.reply('❌ TLDR is currently disabled for this group.');
        return;
      }

      // Handle reply-to message case
      const replyToMessage = ctx.message?.reply_to_message;
      if (replyToMessage) {
        await this.handleTLDRFromMessage(ctx, replyToMessage.message_id);
        return;
      }

      // Handle time-based summary
      const args = ctx.message?.text?.split(' ') || [];
      const timeframe = args[1] || '1h';
      const since = this.parseTimeframe(timeframe);

      loadingMsg = await ctx.reply('⏳ Generating summary...');

      const messages = await this.db.getMessagesSinceTimestamp(chat.id, since);
      if (messages.length === 0) {
        await ctx.api.editMessageText(chat.id, loadingMsg.message_id, '📭 No messages found in the specified time range.');
        return;
      }

      const decryptedKey = this.encryption.decrypt(group.gemini_api_key_encrypted);
      const gemini = new GeminiService(decryptedKey);
      const summary = await gemini.summarizeMessages(messages);

      await ctx.api.editMessageText(
        chat.id,
        loadingMsg.message_id,
        `📝 <b>TLDR Summary</b> (${timeframe})\n\n${summary}`,
        { parse_mode: 'HTML' }
      );
    } catch (error: any) {
      console.error('Error generating TLDR:', error);
      console.error('Error details:', error.message, error.status);

      // Try to edit the loading message to show error
      try {
        if (loadingMsg) {
          await ctx.api.editMessageText(chat.id, loadingMsg.message_id, '❌ Error generating summary. Please try again later.');
        } else {
          await ctx.reply('❌ Error generating summary. Please try again later.');
        }
      } catch (editError) {
        // If edit fails, send new message
        await ctx.reply('❌ Error generating summary. Please try again later.');
      }
    }
  }

  private async handleTLDRFromMessage(ctx: MyContext, fromMessageId: number) {
    let loadingMsg: any = null;
    const chat = ctx.chat!;

    try {
      const group = await this.db.getGroup(chat.id);
      const decryptedKey = this.encryption.decrypt(group.gemini_api_key_encrypted);

      loadingMsg = await ctx.reply('⏳ Generating summary...');

      const messages = await this.db.getMessagesSinceMessageId(chat.id, fromMessageId);
      if (messages.length === 0) {
        await ctx.api.editMessageText(chat.id, loadingMsg.message_id, '📭 No messages found from this point.');
        return;
      }

      const gemini = new GeminiService(decryptedKey);
      const summary = await gemini.summarizeMessages(messages);

      await ctx.api.editMessageText(
        chat.id,
        loadingMsg.message_id,
        `📝 <b>TLDR Summary</b> (from message)\n\n${summary}`,
        { parse_mode: 'HTML' }
      );
    } catch (error: any) {
      console.error('Error generating TLDR from message:', error);
      console.error('Error details:', error.message, error.status);

      try {
        if (loadingMsg) {
          await ctx.api.editMessageText(chat.id, loadingMsg.message_id, '❌ Error generating summary. Please try again later.');
        } else {
          await ctx.reply('❌ Error generating summary. Please try again later.');
        }
      } catch (editError) {
        await ctx.reply('❌ Error generating summary. Please try again later.');
      }
    }
  }

  private async handleTLDRInfo(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat || chat.type === 'private') {
      await ctx.reply('❌ This command can only be used in a group.');
      return;
    }

    try {
      const group = await this.db.getGroup(chat.id);
      if (!group) {
        await ctx.reply('❌ This group is not configured.');
        return;
      }

      const status = group.gemini_api_key_encrypted
        ? '✅ Configured and ready'
        : '⏳ Pending setup';
      const enabledStatus = group.enabled ? '✅ Enabled' : '❌ Disabled';

      await ctx.reply(
        `ℹ️ <b>TLDR Info</b>\n\n` +
        `Status: ${status}\n` +
        `Bot: ${enabledStatus}\n\n` +
        `🔒 Messages auto-delete after 48 hours\n\n` +
        `<i>Use /tldr [timeframe] or reply to a message with /tldr</i>`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Error getting TLDR info:', error);
      await ctx.reply('❌ Error retrieving info.');
    }
  }

  private async handleMessageCache(ctx: MyContext) {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return;
    }

    // Don't cache bot commands or empty messages
    if (ctx.message?.text?.startsWith('/')) {
      return;
    }

    const content = ctx.message?.text || ctx.message?.caption || '';
    if (!content || !ctx.message) {
      return;
    }

    try {
      await this.db.insertMessage({
        chatId: chat.id,
        messageId: ctx.message.message_id,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        content: content.substring(0, 5000), // Limit content length
      });
    } catch (error) {
      console.error('Error caching message:', error);
    }
  }

  private parseTimeframe(timeframe: string): Date {
    const now = Date.now();
    let hours = 1;

    if (timeframe.endsWith('h')) {
      hours = parseInt(timeframe.slice(0, -1), 10) || 1;
    } else if (timeframe.endsWith('d') || timeframe === 'day') {
      hours = timeframe === 'day' ? 24 : parseInt(timeframe.slice(0, -1), 10) * 24 || 24;
    } else if (timeframe === 'week') {
      hours = 168;
    } else {
      hours = 1; // Default to 1 hour
    }

    return new Date(now - hours * 60 * 60 * 1000);
  }
}
