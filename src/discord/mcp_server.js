require('dotenv').config({ path: '../../.env' });
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

// This MCP Server allows AI agents to interact with the Discord bot to perform moderation tasks.

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is not set in environment.");
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

const server = new Server(
  {
    name: 'naracord-moderator',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'warn_user',
        description: 'Send a warning DM to a user',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'Discord User ID' },
            reason: { type: 'string', description: 'Reason for warning' }
          },
          required: ['userId', 'reason'],
        },
      },
      {
        name: 'timeout_user',
        description: 'Timeout (mute) a user in a specific guild',
        inputSchema: {
          type: 'object',
          properties: {
            guildId: { type: 'string', description: 'Discord Guild ID' },
            userId: { type: 'string', description: 'Discord User ID' },
            minutes: { type: 'number', description: 'Duration in minutes' },
            reason: { type: 'string', description: 'Reason for timeout' }
          },
          required: ['guildId', 'userId', 'minutes', 'reason'],
        },
      },
      {
        name: 'kick_user',
        description: 'Kick a user from a specific guild',
        inputSchema: {
          type: 'object',
          properties: {
            guildId: { type: 'string', description: 'Discord Guild ID' },
            userId: { type: 'string', description: 'Discord User ID' },
            reason: { type: 'string', description: 'Reason for kick' }
          },
          required: ['guildId', 'userId', 'reason'],
        },
      },
      {
        name: 'ban_user',
        description: 'Ban a user from a specific guild',
        inputSchema: {
          type: 'object',
          properties: {
            guildId: { type: 'string', description: 'Discord Guild ID' },
            userId: { type: 'string', description: 'Discord User ID' },
            reason: { type: 'string', description: 'Reason for ban' }
          },
          required: ['guildId', 'userId', 'reason'],
        },
      }
    ],
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'warn_user': {
        const { userId, reason } = args;
        
        // To send a DM, we need to create a DM channel using REST API
        const dmChannel = await rest.post(Routes.userChannels(), {
          body: { recipient_id: userId }
        });
        
        await rest.post(Routes.channelMessages(dmChannel.id), {
          body: { content: `⚠️ **WARNING**: ${reason}` }
        });
        
        return { content: [{ type: 'text', text: `Successfully sent warning to user ${userId}` }] };
      }

      case 'timeout_user': {
        const { guildId, userId, minutes, reason } = args;
        const communication_disabled_until = new Date(Date.now() + minutes * 60000).toISOString();
        
        await rest.patch(Routes.guildMember(guildId, userId), {
          body: { communication_disabled_until },
          headers: { 'X-Audit-Log-Reason': reason }
        });
        
        return { content: [{ type: 'text', text: `Successfully timed out user ${userId} for ${minutes} minutes in guild ${guildId}` }] };
      }

      case 'kick_user': {
        const { guildId, userId, reason } = args;
        
        await rest.delete(Routes.guildMember(guildId, userId), {
          headers: { 'X-Audit-Log-Reason': reason }
        });
        
        return { content: [{ type: 'text', text: `Successfully kicked user ${userId} from guild ${guildId}` }] };
      }

      case 'ban_user': {
        const { guildId, userId, reason } = args;
        
        await rest.put(Routes.guildBan(guildId, userId), {
          body: { delete_message_seconds: 86400 }, // delete messages from the last day
          headers: { 'X-Audit-Log-Reason': reason }
        });
        
        return { content: [{ type: 'text', text: `Successfully banned user ${userId} from guild ${guildId}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error executing ${name}:`, error);
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Naracord Moderation MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
