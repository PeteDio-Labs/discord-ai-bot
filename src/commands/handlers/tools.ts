// /tools command handler - list available AI tools with optional detail view
import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { registry } from '../../ai/ToolRegistry.js';
import { toolCatalog } from '../../data/toolCatalog.js';
import { logger } from '../../utils/index.js';

export async function handleToolsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const toolName = interaction.options.getString('tool');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTimestamp();

  if (toolName) {
    // Detail view for a specific tool
    const entry = toolCatalog[toolName];
    if (!entry) {
      embed.setTitle('Unknown Tool').setDescription(`No tool named \`${toolName}\` found.`);
    } else {
      embed.setTitle(`Tool: ${toolName}`);
      embed.setDescription(entry.summary);

      if (entry.type === 'action-based' && entry.actions) {
        const actionLines = entry.actions.map((a) => {
          const params = [
            ...a.requiredParams.map((p) => `**${p}** (required)`),
            ...a.optionalParams.map((p) => `${p} (optional)`),
          ].join(', ');
          return `\`${a.name}\` — ${a.description}${params ? `\n  Params: ${params}` : ''}`;
        });

        // Split into chunks that fit within Discord's 1024-char field limit
        const chunks: string[] = [];
        let current = '';
        for (const line of actionLines) {
          const candidate = current ? `${current}\n${line}` : line;
          if (candidate.length > 1024) {
            if (current) chunks.push(current);
            current = line;
          } else {
            current = candidate;
          }
        }
        if (current) chunks.push(current);

        for (let i = 0; i < chunks.length; i++) {
          embed.addFields({
            name: i === 0 ? 'Actions' : 'Actions (cont.)',
            value: chunks[i]!,
            inline: false,
          });
        }
      } else if (entry.parameters) {
        embed.addFields({
          name: 'Parameters',
          value: entry.parameters.map((p) => `\`${p}\``).join(', '),
          inline: false,
        });
      }

      embed.addFields({
        name: 'Examples',
        value: entry.examples.map((e) => `- ${e}`).join('\n'),
        inline: false,
      });

      if (entry.notes) {
        embed.setFooter({ text: entry.notes });
      }
    }
  } else {
    // List-all view
    embed.setTitle('Available AI Tools');
    embed.setDescription('Use `/tools tool:<name>` for detailed info on any tool.');

    const tools = registry.getToolDescriptions();
    for (const tool of tools) {
      const entry = toolCatalog[tool.name];
      const typeLabel = entry?.type === 'action-based' ? '[action-based]' : '[simple]';
      const summary = entry?.summary || tool.description;
      embed.addFields({
        name: `\`${tool.name}\` ${typeLabel}`,
        value: summary,
        inline: false,
      });
    }
  }

  try {
    await interaction.reply({ embeds: [embed] });
  } catch (replyErr) {
    logger.warn(
      'Failed to send tools embed reply:',
      replyErr instanceof Error ? replyErr.message : replyErr
    );
    try {
      await interaction.followUp({ content: 'Failed to send tools list.', ephemeral: true });
    } catch (fuErr) {
      logger.error('followUp failed:', fuErr);
    }
  }
}

export default handleToolsCommand;
