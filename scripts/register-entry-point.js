//   node scripts/register-entry-point.js
//   node scripts/register-entry-point.js --fix
//   node scripts/register-entry-point.js --fix --handler=1

// handler=1: The bot sends a message with a button, and your server handles the launch. The user sees a pop up of the activity and can click it to launch it. But it can send a message max like 3 times.
// handler=2: Discord launches the activity directly, but no pop up of it except its own message that the user can click. 
import 'dotenv/config';

const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID } = process.env;
if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID in .env first.');
  process.exit(1);
}

const fix = process.argv.includes('--fix');
const handlerArg = process.argv.find((a) => a.startsWith('--handler='));
const handler = handlerArg ? Number(handlerArg.split('=')[1]) : 2;
if (![1, 2].includes(handler)) {
  console.error('--handler must be 1 or 2');
  process.exit(1);
}
const url = `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/commands`;
const headers = { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };

const wanted = {
  name: 'launch',
  description: 'Launch the cube timer',
  type: 4, // PRIMARY_ENTRY_POINT
  handler, // 2 = DISCORD_LAUNCH_ACTIVITY, 1 = APP_HANDLER
  integration_types: [0, 1], // guild install, user install
  contexts: [0, 1, 2], // guild, bot DM, private channel
};

const list = await fetch(url, { headers });
if (!list.ok) {
  console.error('Could not list commands:', list.status, await list.text());
  process.exit(1);
}
const commands = await list.json();
const existing = commands.find((c) => c.type === 4);

if (!existing) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(wanted) });
  console.log(res.ok ? 'Created the Launch entry point.' : `Failed: ${res.status} ${await res.text()}`);
  process.exit(0);
}

console.log('Current entry point:');
console.log(
  JSON.stringify(
    {
      id: existing.id,
      name: existing.name,
      handler: existing.handler,
      integration_types: existing.integration_types,
      contexts: existing.contexts,
      default_member_permissions: existing.default_member_permissions,
    },
    null,
    2,
  ),
);

if (!fix) {
  console.log('\nRun again with --fix to reset it to the standard settings.');
  process.exit(0);
}

const res = await fetch(`${url}/${existing.id}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    handler,
    integration_types: wanted.integration_types,
    contexts: wanted.contexts,
    default_member_permissions: null,
  }),
});

console.log(res.ok ? 'Entry point reset. Restart Discord (Ctrl+R) and check again.' : `Failed: ${res.status} ${await res.text()}`);
