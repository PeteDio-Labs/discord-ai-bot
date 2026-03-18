// /ask command handler with tool support — always sends full response to DMs
import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { OllamaClient } from '../../ai/OllamaClient.js';
import { ToolExecutor } from '../../ai/ToolExecutor.js';
import type { ToolExecutionRecord } from '../../ai/types.js';
import { isUserAuthorized, logger } from '../../utils/index.js';

function truncate(text: string | undefined, maxLength: number): string {
  if (!text) return 'No response';
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

export function buildToolSummary(toolsUsed: ToolExecutionRecord[]): string | null {
  if (toolsUsed.length === 0) return null;
  const toolCounts = new Map<string, number>();
  for (const t of toolsUsed) {
    toolCounts.set(t.name, (toolCounts.get(t.name) || 0) + 1);
  }
  return Array.from(toolCounts.entries())
    .map(([name, count]) => count > 1 ? `\`${name}\` ×${count}` : `\`${name}\``)
    .join(', ');
}

async function sendResponseDM(
  interaction: ChatInputCommandInteraction,
  question: string,
  response: string,
  toolSummary: string | null
): Promise<boolean> {
  try {
    const dmChannel = await interaction.user.createDM();

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('AI Response')
      .addFields({ name: 'Question', value: truncate(question, 1024), inline: false })
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    // Use field for short answers, description for longer ones
    if (response.length <= 1024) {
      embed.addFields({ name: 'Answer', value: response || 'No response', inline: false });
    } else {
      embed.setDescription(response.substring(0, 4096));
    }

    if (toolSummary) {
      embed.addFields({ name: 'Tools Used', value: toolSummary, inline: false });
    }

    await dmChannel.send({ embeds: [embed] });

    // Send overflow as plain text chunks if response exceeds embed description limit
    if (response.length > 4096) {
      const overflow = response.substring(4096);
      for (let i = 0; i < overflow.length; i += 1900) {
        await dmChannel.send({ content: overflow.substring(i, i + 1900) });
      }
    }

    return true;
  } catch (dmErr) {
    logger.warn('Could not DM user:', dmErr instanceof Error ? dmErr.message : dmErr);
    return false;
  }
}

export async function handleAskCommand(
  interaction: ChatInputCommandInteraction,
  ollamaClient: OllamaClient,
  allowedUsers: string[]
): Promise<void> {
  logger.info(`/ask command received from user ${interaction.user.tag} (${interaction.user.id})`);

  if (!isUserAuthorized(interaction.user.id, allowedUsers)) {
    logger.info(`User ${interaction.user.id} is not authorized`);
    try {
      await interaction.reply({
        content: 'You are not authorized to use this command.',
        ephemeral: true,
      });
    } catch (err) {
      logger.warn('Auth reply failed:', err instanceof Error ? err.message : err);
    }
    return;
  }

  // Defer reply IMMEDIATELY - must happen within 3 seconds
  try {
    await interaction.deferReply();
  } catch (deferErr) {
    logger.error(
      'deferReply failed - interaction likely expired:',
      deferErr instanceof Error ? deferErr.message : deferErr
    );
    return;
  }

  try {
    const question = interaction.options.getString('question', true);
    logger.info(`Processing question: "${question.substring(0, 100)}${question.length > 100 ? '...' : ''}"`);

    const isAvailable = await ollamaClient.isAvailable();
    if (!isAvailable) {
      logger.warn('Ollama service unavailable');
      await interaction.editReply({
        content: 'AI service is currently unavailable. Please try again later.',
      });
      return;
    }
    logger.info('Ollama service is available');

    const executor = new ToolExecutor(ollamaClient);
    const result = await executor.processMessage(question);
    logger.info(`Tool execution completed. Tools used: ${result.toolsUsed.map((t) => t.name).join(', ') || 'none'}`);
    logger.debug(`Response length: ${result.response.length} characters`);

    const toolSummary = buildToolSummary(result.toolsUsed);

    // Always send full response to DMs
    const dmSuccess = await sendResponseDM(interaction, question, result.response, toolSummary);

    if (dmSuccess) {
      // Delete the deferred channel reply — nothing to show in the channel
      try {
        await interaction.deleteReply();
      } catch (deleteErr) {
        logger.warn('Failed to delete deferred reply:', deleteErr instanceof Error ? deleteErr.message : deleteErr);
      }
      logger.info(`/ask command completed successfully for user ${interaction.user.id}`);
    } else {
      // DM failed — fall back to ephemeral follow-ups
      try {
        await interaction.deleteReply();
      } catch (deleteErr) {
        logger.warn('Failed to delete deferred reply:', deleteErr instanceof Error ? deleteErr.message : deleteErr);
      }
      const chunkSize = 1900;
      try {
        for (let i = 0; i < result.response.length; i += chunkSize) {
          await interaction.followUp({
            content: result.response.substring(i, i + chunkSize),
            ephemeral: true,
          });
        }
      } catch (followErr) {
        logger.error('Failed to send ephemeral follow-ups:', followErr);
      }
    }
  } catch (error) {
    logger.error('Ask command error:', error);
    try {
      await interaction.editReply({
        content: 'Failed to get AI response. Please try again later.',
      });
    } catch (errReply) {
      logger.error('Failed to send error reply:', errReply instanceof Error ? errReply.message : errReply);
    }
  }
}

export default handleAskCommand;
