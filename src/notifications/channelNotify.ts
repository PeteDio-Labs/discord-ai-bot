// Channel notification utility — extensible for future Mission Control alerts
import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../utils/index.js';

export interface ChannelNotification {
  type: 'dm_sent' | 'dm_failed' | 'alert';
  message: string;
  context?: string;
}

const NOTIFICATION_COLORS: Record<ChannelNotification['type'], number> = {
  dm_sent: 0x57f287,  // green
  dm_failed: 0xed4245, // red
  alert: 0xfee75c,     // yellow
};

export async function sendChannelNotification(
  interaction: ChatInputCommandInteraction,
  notification: ChannelNotification
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(NOTIFICATION_COLORS[notification.type])
    .setDescription(notification.message);

  if (notification.context) {
    embed.setFooter({ text: notification.context });
  }

  try {
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to send channel notification:', err instanceof Error ? err.message : err);
  }
}
