/**
 * SSE Event Stream Listener
 *
 * Connects to MC Backend's SSE endpoint and DMs the owner
 * when infrastructure events arrive (deploys, restarts, syncs, etc.).
 */

import { Client, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/index.js';
import { sseEventsReceived, sseConnected, sseDmsSent } from '../metrics/index.js';

interface InfraEvent {
  type: string;
  source: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  namespace?: string;
  affected_service?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

const SEVERITY_COLORS: Record<string, number> = {
  critical: 0xed4245, // red
  warning: 0xf39c12,  // orange
  info: 0x3498db,     // blue
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  info: 'INFO',
};

const SOURCE_ICONS: Record<string, string> = {
  kubernetes: 'K8s',
  argocd: 'ArgoCD',
  proxmox: 'Proxmox',
};

function buildEventEmbed(event: InfraEvent): EmbedBuilder {
  const color = SEVERITY_COLORS[event.severity] ?? 0x3498db;
  const severityLabel = SEVERITY_LABELS[event.severity] ?? 'INFO';
  const sourceLabel = SOURCE_ICONS[event.source] ?? event.source;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${severityLabel} | ${sourceLabel}`)
    .setDescription(event.message)
    .setTimestamp(event.timestamp ? new Date(event.timestamp) : new Date());

  if (event.type) {
    embed.addFields({ name: 'Type', value: event.type, inline: true });
  }
  if (event.affected_service) {
    embed.addFields({ name: 'Service', value: event.affected_service, inline: true });
  }
  if (event.namespace) {
    embed.addFields({ name: 'Namespace', value: event.namespace, inline: true });
  }

  return embed;
}

async function sendDM(client: Client, ownerUserId: string, event: InfraEvent): Promise<void> {
  try {
    const user = await client.users.fetch(ownerUserId);
    const dmChannel = await user.createDM();
    const embed = buildEventEmbed(event);
    await dmChannel.send({ embeds: [embed] });
    sseDmsSent.inc({ status: 'success' });
  } catch (err) {
    sseDmsSent.inc({ status: 'failure' });
    logger.error('Failed to send event DM:', err instanceof Error ? err.message : err);
  }
}

export function startEventStream(
  client: Client,
  mcBackendUrl: string,
  ownerUserId: string
): void {
  if (!ownerUserId) {
    logger.warn('[EventStream] No OWNER_USER_ID configured — DM alerts disabled');
    return;
  }

  const streamUrl = `${mcBackendUrl}/api/v1/events/stream`;
  let retryDelay = 1000;
  const MAX_RETRY_DELAY = 30000;

  async function connect(): Promise<void> {
    logger.info(`[EventStream] Connecting to ${streamUrl}`);

    try {
      const response = await fetch(streamUrl, {
        headers: { Accept: 'text/event-stream' },
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      sseConnected.set(1);
      retryDelay = 1000; // Reset on successful connect
      logger.info('[EventStream] Connected to SSE stream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            // Skip connection confirmation
            if (data.type === 'connected') continue;

            const event = data as InfraEvent;
            sseEventsReceived.inc({
              source: event.source ?? 'unknown',
              type: event.type ?? 'unknown',
              severity: event.severity ?? 'info',
            });

            logger.info(`[EventStream] Event: ${event.source}/${event.type} — ${event.message}`);
            await sendDM(client, ownerUserId, event);
          } catch {
            // Ignore malformed SSE data lines (pings, etc.)
          }
        }
      }

      // Stream ended normally
      sseConnected.set(0);
      logger.warn('[EventStream] SSE stream ended, reconnecting...');
    } catch (err) {
      sseConnected.set(0);
      logger.error(`[EventStream] Connection error: ${err instanceof Error ? err.message : err}`);
    }

    // Reconnect with exponential backoff
    logger.info(`[EventStream] Reconnecting in ${retryDelay / 1000}s...`);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
  }

  connect();
}
