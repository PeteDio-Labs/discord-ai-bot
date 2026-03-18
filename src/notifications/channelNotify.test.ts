import { describe, it, expect, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { sendChannelNotification, type ChannelNotification } from './channelNotify.js';

vi.mock('../utils/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockInteraction() {
  const editReplyArgs: unknown[] = [];

  const interaction = {
    editReply: vi.fn().mockImplementation((args: unknown) => {
      editReplyArgs.push(args);
      return Promise.resolve();
    }),
  } as unknown as ChatInputCommandInteraction;

  return { interaction, editReplyArgs };
}

describe('sendChannelNotification', () => {
  it('should send an embed notification via interaction.editReply', async () => {
    const { interaction, editReplyArgs } = createMockInteraction();
    const notification: ChannelNotification = {
      type: 'dm_sent',
      message: 'Response sent to your DMs.',
    };

    await sendChannelNotification(interaction, notification);

    expect(interaction.editReply).toHaveBeenCalled();
    const args = editReplyArgs[0] as { embeds?: { data: { description?: string } }[] };
    expect(args.embeds).toBeDefined();
    expect(args.embeds?.[0]?.data.description).toBe('Response sent to your DMs.');
  });

  it('should use green color for dm_sent type and red for dm_failed', async () => {
    const { interaction: int1, editReplyArgs: args1 } = createMockInteraction();
    await sendChannelNotification(int1, { type: 'dm_sent', message: 'ok' });
    const embed1 = (args1[0] as { embeds: { data: { color?: number } }[] }).embeds?.[0];
    expect(embed1).toBeDefined();
    expect(embed1!.data.color).toBe(0x57f287); // green

    const { interaction: int2, editReplyArgs: args2 } = createMockInteraction();
    await sendChannelNotification(int2, { type: 'dm_failed', message: 'fail' });
    const embed2 = (args2[0] as { embeds: { data: { color?: number } }[] }).embeds?.[0];
    expect(embed2).toBeDefined();
    expect(embed2!.data.color).toBe(0xed4245); // red
  });

  it('should support alert type with yellow color', async () => {
    const { interaction, editReplyArgs } = createMockInteraction();
    await sendChannelNotification(interaction, { type: 'alert', message: 'Alert!' });
    const embed = (editReplyArgs[0] as { embeds: { data: { color?: number } }[] }).embeds?.[0];
    expect(embed).toBeDefined();
    expect(embed!.data.color).toBe(0xfee75c); // yellow
  });

  it('should include context as footer when provided', async () => {
    const { interaction, editReplyArgs } = createMockInteraction();
    await sendChannelNotification(interaction, {
      type: 'dm_sent',
      message: 'Sent!',
      context: 'Question: What is K8s?',
    });
    const embed = (editReplyArgs[0] as { embeds: { data: { footer?: { text: string } } }[] }).embeds?.[0];
    expect(embed).toBeDefined();
    expect(embed!.data.footer?.text).toBe('Question: What is K8s?');
  });
});
