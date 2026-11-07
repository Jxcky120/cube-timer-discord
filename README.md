# Cube Timer: Discord Activity

Speedcubing timer that runs inside Discord and posts your solves (time + scramble) to the channel.

## Future plans
- A multiplayer cube lobby that runs on same set of scrambles and shares time with each other. Sort of an tournament style but for fun. (Yes people can just cheat, but it is more for friends I guess idk)

## Deployment

### 1. Discord Developer Portal

1. Create an application at https://discord.com/developers/applications
2. **General Information**: copy the *Application ID* into `DISCORD_CLIENT_ID`.
3. **OAuth2**: copy the *Client Secret* into `DISCORD_CLIENT_SECRET`. Add a redirect `https://127.0.0.1`.
4. **Bot**: *Reset Token*, copy it into `DISCORD_BOT_TOKEN`.
5. **Installation**: add the `bot` scope with the *Send Messages* permission, then invite the bot to your test server with the generated link.
6. **Activities**: enable Activities, then turn on *Application Test mode* for your account (User Settings → Advanced → Developer Mode).
7. Leave **Interactions Endpoint URL** empty. The bot receives launches and button clicks over the gateway.
8. Entry point must be handled by the bot: `node scripts/register-entry-point.js --fix --handler=1`.

### 2. Run

```bash
npm install
npm run dev          # API on :3001, Vite on :5173
npm run tunnel       # in a second terminal (needs cloudflared), prints https://xxxx.trycloudflare.com
```

(ngrok works too: `ngrok http 5173`.)

In the portal under **Activities → URL Mappings**, set `/` to the tunnel host without `https://`, e.g. `xxxx.trycloudflare.com`.
The URL changes each time you restart a quick tunnel, so update the mapping when it does.

Then join a voice channel in your server and launch the activity from the App Launcher (rocket icon).

Opening http://localhost:5173 directly in a browser works as an offline timer (no sending).

### Controls

| Action | Result |
|---|---|
| Hold space (or press and hold the screen) | Turns red, then green after 0.5 s |
| Release when green | Timer starts |
| Press space again | Timer stops, "Send to chat" appears |


### How the card works

- Launching (or pressing **Play now!** on the card) starts the activity. The bot posts the card on launch.
- **Send score** in the activity edits that same message. Editing is not limited to 5 posts like
  new follow-up messages are.
- Discord only lets the launch message be edited for about 15 minutes. Pressing **Play now!** gives the
  bot a fresh window. In servers the bot then falls back to posting its own card, which never expires.
  In DMs, relaunch or use **Copy result**.
- **My scores** replies privately (only the clicker sees it) with their own solves, best, mean and Ao5.
- Solves are kept in memory, so restarting the server clears the session history.


### Layout

- `server/index.js`: Express API + discord.js bot (launch, buttons, card updates)
- `server/card.js`: draws the card image with @napi-rs/canvas
- `client/`: Vite frontend (timer, scrambler, 2D net, Discord SDK)
