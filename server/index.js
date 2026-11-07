import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  escapeMarkdown,
} from 'discord.js';
import { renderCard } from './card.js';
import { ao5, best, formatTime, mean } from './format.js';

// ---------- config ----------
const REQUIRED = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k] || process.env[k].startsWith('your_'));
if (missing.length) {
  console.error(`Missing values in .env: ${missing.join(', ')}`);
  process.exit(1);
}
const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = process.env;
const PORT = Number(process.env.PORT) || 3001;

const TOKEN_TTL_MS = 14 * 60 * 1000; // interaction tokens TTL is 15 minutes
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_SOLVES = 200;

// Set up the bot client to post messages in servers. 
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
bot.once('clientReady', (c) => console.log(`Bot logged in as ${c.user.tag}`));
await bot.login(DISCORD_BOT_TOKEN);

// HTTP error with a status code, for express error handling.
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Same shape whether it comes from discord.js (User) or the REST API (/users/@me).
const userInfo = (u) => ({ id: u.id, name: u.globalName ?? u.global_name ?? u.username, avatar: u.avatar });

// Resolve the caller from their OAuth token instead of trusting a userId from the client.
const userCache = new Map();
async function requireUser(req, _res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) throw httpError(401, 'Missing access token');

  const cached = userCache.get(token);
  if (cached && cached.expires > Date.now()) {
    req.user = cached.user;
    return next();
  }
  const r = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw httpError(401, 'Invalid Discord access token');
  const user = userInfo(await r.json());
  userCache.set(token, { user, expires: Date.now() + 5 * 60 * 1000 });
  req.user = user;
  next();
}

// Session = {
//   channelId, guildId|null, startedBy, solves: [{ user, timeMs, scramble }],
//   editor:  { webhook, messageId, expires } | null   // interaction token, valid ~15 min
//   cardId:  id of the message we posted on launch
//   botMessage: Message | null                         // bot-owned card, servers only, never expires
//   lock: Promise                                      // serialises card edits
//   members: Set of user ids already verified for this server
// }
const sessions = new Map(); // channelId -> newest session in that channel
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touched > SESSION_IDLE_MS) sessions.delete(id);
}, 10 * 60 * 1000).unref();

const serialize = (session, fn) => {
  const run = session.lock.then(fn);
  session.lock = run.catch(() => {});
  return run;
};

const newSession = ({ channelId, guildId, startedBy }) => ({
  channelId,
  guildId,
  startedBy,
  solves: [],
  editor: null,
  cardId: null,
  botMessage: null,
  lock: Promise.resolve(),
  members: new Set(),
  touched: Date.now(),
});

const buttons = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cube:play').setLabel('Play now!').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cube:scores').setLabel('My scores').setStyle(ButtonStyle.Secondary),
  );

async function cardPayload(session) {
  const latest = session.solves.at(-1) ?? null;
  const subject = latest ? latest.user : session.startedBy;
  const png = await renderCard({
    user: subject,
    latest,
    count: session.solves.length,
    recent: session.solves
      .slice(-5)
      .reverse()
      .map((s) => ({ timeMs: s.timeMs, name: s.user.name })),
  });
  const alt = latest
    ? `${subject.name} solved a 3x3 in ${formatTime(latest.timeMs)}`
    : `${subject.name} started a cubing session`;
  return {
    content: `🧊 **${escapeMarkdown(session.startedBy.name)}** was cubing`,
    files: [new AttachmentBuilder(png, { name: 'cube.png', description: alt })],
    components: [buttons()],
    allowedMentions: { parse: [] },
  };
}

async function getBotChannel(channelId) {
  if (typeof channelId !== 'string' || !/^\d{15,25}$/.test(channelId)) {
    throw httpError(400, 'Invalid channel id');
  }
  const channel = await bot.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.guild) {
    throw httpError(
      404,
      'No active session in this chat. Relaunch the activity from the App Launcher, or use Copy result.',
    );
  }
  const perms = channel.permissionsFor(bot.user);
  const need = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ];
  if (!perms?.has(need)) {
    throw httpError(403, 'The bot needs View Channel, Send Messages and Attach Files in this channel.');
  }
  return channel;
}

// Update the card: first with the interaction token, then (servers only) with the bot itself.
async function refreshCard(session) {
  const payload = await cardPayload(session);
  const edit = { ...payload, attachments: [] }; // replace the old image

  const ed = session.editor;
  if (ed && ed.expires > Date.now()) {
    try {
      await ed.webhook.editMessage(ed.messageId, edit);
      return;
    } catch (err) {
      console.warn('[card] edit via interaction token failed:', err.message);
      session.editor = null;
    }
  }

  if (session.guildId) {
    const channel = await getBotChannel(session.channelId);
    if (session.botMessage) {
      try {
        await session.botMessage.edit(edit);
        return;
      } catch {
        session.botMessage = null;
      }
    }
    session.botMessage = await channel.send(payload);
    return;
  }

  throw httpError(
    410,
    'This session expired (Discord only allows editing the launch message for about 15 minutes). Press Play now! on the message or relaunch, or use Copy result.',
  );
}

async function onLaunch(interaction) {
  await interaction.launchActivity();
  const session = newSession({
    channelId: interaction.channelId,
    guildId: interaction.guildId ?? null,
    startedBy: userInfo(interaction.user),
  });
  sessions.set(session.channelId, session);
  console.log(`[card] launch by ${session.startedBy.name} in ${session.channelId}`);

  await serialize(session, async () => {
    const message = await interaction.webhook.send(await cardPayload(session));
    session.cardId = message.id;
    session.editor = {
      webhook: interaction.webhook,
      messageId: message.id,
      expires: Date.now() + TOKEN_TTL_MS,
    };
  });
}

async function onPlay(interaction) {
  await interaction.launchActivity();
  const session = sessions.get(interaction.channelId);
  if (session && session.cardId === interaction.message.id) {
    session.editor = {
      webhook: interaction.webhook,
      messageId: '@original',
      expires: Date.now() + TOKEN_TTL_MS,
    };
  }
}

async function onScores(interaction) {
  const session = sessions.get(interaction.channelId);
  const mine = session ? session.solves.filter((s) => s.user.id === interaction.user.id) : [];
  const embed = new EmbedBuilder()
    .setColor(0x39c5bb)
    .setAuthor({
      name: interaction.user.globalName ?? interaction.user.username,
      iconURL: interaction.user.displayAvatarURL({ size: 128 }),
    })
    .setTitle('Your solves');

  if (!mine.length) {
    embed.setDescription('No solves posted yet. Press **Send score** in the activity after a solve.');
  } else {
    const times = mine.map((s) => s.timeMs);
    const lines = mine
      .map((s, i) => `**#${i + 1}**  \`${formatTime(s.timeMs)}\``)
      .slice(-10)
      .reverse();
    embed.setDescription(lines.join('\n')).addFields(
      { name: 'Best', value: `\`${formatTime(best(times))}\``, inline: true },
      { name: 'Mean', value: `\`${formatTime(mean(times))}\``, inline: true },
      {
        name: 'Ao5',
        value: ao5(times) === null ? '—' : `\`${formatTime(ao5(times))}\``,
        inline: true,
      },
    );
    embed.setFooter({ text: `${mine.length} solve${mine.length === 1 ? '' : 's'} this session` });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

bot.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isPrimaryEntryPointCommand()) return await onLaunch(interaction);
    if (interaction.isButton()) {
      if (interaction.customId === 'cube:play') return await onPlay(interaction);
      if (interaction.customId === 'cube:scores') return await onScores(interaction);
    }
  } catch (err) {
    console.error('[interaction] failed:', err);
  }
});

// ---------- express ----------
const app = express();
app.use(express.json({ limit: '10kb' }));

app.post('/api/token', async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string') throw httpError(400, 'Missing code');

  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw httpError(400, data.error_description || 'Token exchange failed');
  res.json({ access_token: data.access_token });
});

// Post a solve: adds it to the session and updates the card message.
app.post('/api/solve', requireUser, async (req, res) => {
  const { channelId, timeMs, scramble } = req.body ?? {};
  if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs >= 60 * 60 * 1000) {
    throw httpError(400, 'Invalid time');
  }
  if (typeof scramble !== 'string' || scramble.length > 200 || !/^[UDLRFB2' ]+$/.test(scramble)) {
    throw httpError(400, 'Invalid scramble');
  }
  if (typeof channelId !== 'string' || !/^\d{15,25}$/.test(channelId)) {
    throw httpError(400, 'Invalid channel id');
  }

  let session = sessions.get(channelId);
  if (!session) {
    const channel = await getBotChannel(channelId);
    session = newSession({ channelId, guildId: channel.guild.id, startedBy: req.user });
    sessions.set(channelId, session);
  }

  // Servers: only members may post. DMs: the channel id is only known to the people in the chat.
  if (session.guildId && !session.members.has(req.user.id)) {
    const guild = bot.guilds.cache.get(session.guildId);
    if (guild) {
      const member = await guild.members.fetch(req.user.id).catch(() => null);
      if (!member) throw httpError(403, 'You are not a member of this server.');
    }
    session.members.add(req.user.id);
  }

  const entry = { user: req.user, timeMs, scramble };
  session.solves.push(entry);
  if (session.solves.length > MAX_SOLVES) session.solves.shift();
  session.touched = Date.now();

  try {
    await serialize(session, () => refreshCard(session));
  } catch (err) {
    session.solves = session.solves.filter((s) => s !== entry);
    throw err;
  }
  res.json({ ok: true });
});

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (fs.existsSync(dist)) app.use(express.static(dist));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
