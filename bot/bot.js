const mineflayer = require('mineflayer');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const https = require('https');

const SERVER_HOST = '69.69.69.69'; // input server ip here
const SERVER_PORT = 25565; // default port, if the server has another port add it here
const NUM_BOTS = 20; // number of bots, 20 means it will join 20 bots and after 3 tries if it failed it will no longer join
const JOIN_DELAY_MS = 5000; // join delay in millisecond, 5000 to avoid connection throttled
const CHAT_SPAM_INTERVAL_MS = 1000; // 1 second spam to avoid getting kicked
const TEST_DURATION = 60 * 1000; // how long should the bots be there
const PASSWORD = 'password6988'; // custom password for login
const TARGET_POS = { x: 69, y: 69, z: 69 }; // target pos
const CHAT_MESSAGES = ['sample text']; // custom messages
const MAX_RETRIES = 3; // retries of bots

const MODE_ALIASES = {
  '1': ['destination'],
  '2': ['hostile'],
  '3': ['rampage'],
  '4': ['grief'],
  '1,2': ['destination', 'hostile'],
  '2,3': ['hostile', 'rampage'],
  '1,3': ['destination', 'rampage'],
  '1,2,3': ['destination', 'hostile', 'rampage'],
  '1,2,3,4': ['destination', 'hostile', 'rampage', 'grief']
};

let SELECTED_MODES = []; // Modes active for the session


// read proxies
let proxies = [];
if (fs.existsSync('proxies.txt')) {
  proxies = fs.readFileSync('proxies.txt', 'utf8')
    .split('\n').map(x => x.trim()).filter(x => x);
}

// username DB
const USERNAME_DB_FILE = './used_usernames.json';
let usedUsernames = new Set();
if (fs.existsSync(USERNAME_DB_FILE)) {
  try {
    usedUsernames = new Set(JSON.parse(fs.readFileSync(USERNAME_DB_FILE, 'utf8')));
  } catch {
    usedUsernames = new Set();
  }
}
function saveUsername(username) {
  usedUsernames.add(username);
  fs.writeFileSync(USERNAME_DB_FILE, JSON.stringify([...usedUsernames], null, 2));
}

// proxy agent
function getAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
  if (proxyUrl.startsWith('http')) return new HttpsProxyAgent(proxyUrl);
  return null;
}

// username generator
function generateUsername() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
  let name = chars.charAt(Math.floor(Math.random() * 52));
  const length = Math.floor(Math.random() * 13) + 3;
  for (let i = 1; i < length; i++) {
    name += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return name;
}

// chat log
function createChatLog(username) {
  const dir = path.resolve(__dirname, 'chatlogs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const logPath = path.join(dir, `${username}.log`);
  return fs.createWriteStream(logPath, { flags: 'a' });
}

// webhook sender
function sendWebhook(webhookUrl, content) {
  const body = JSON.stringify({ content });
  const req = https.request(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length,
    }
  });
  req.write(body);
  req.end();
}

// bot creation with retries
function tryCreateBot(username, webhookUrl, retry = 0) {
  const proxy = proxies.length > 0
    ? proxies[Math.floor(Math.random() * proxies.length)]
    : null;

  const agent = getAgent(proxy);
  const options = {
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: username,
    version: false,
    connect: agent || undefined,
  };

  const isNewUser = !usedUsernames.has(username);
  const bot = mineflayer.createBot(options);
  const chatLog = createChatLog(username);

  let loginSuccessful = false;
  let attemptedAltRegister = false;
  let hasReachedTarget = false;

  bot.once('spawn', () => {
    const msg = `[+] Bot ${username} spawned with proxy ${proxy || 'none'}`;
    console.log(msg);
    chatLog.write(`[SPAWNED] ${new Date().toISOString()}\n`);
    if (webhookUrl) sendWebhook(webhookUrl, msg);

    if (isNewUser) {
      bot.chat(`/register ${PASSWORD} ${PASSWORD}`);
    } else {
      bot.chat(`/login ${PASSWORD}`);
    }
    if (isNewUser) saveUsername(username);

    bot.on('message', (msg) => {
      const text = msg.toString().toLowerCase();
      chatLog.write(`[CHAT] ${msg}\n`);
      if (!loginSuccessful && (text.includes('successfully') || text.includes('already registered') || text.includes('registered'))) {
        loginSuccessful = true;
        console.log(`[>] ${username} logged in`);
        if (webhookUrl) sendWebhook(webhookUrl, `✅ ${username} logged in`);
      }
      if (!loginSuccessful && text.includes('usage') && isNewUser && !attemptedAltRegister) {
        attemptedAltRegister = true;
        bot.chat(`/register ${PASSWORD}`);
      }
    });

    const stateCheck = setInterval(() => {
      if (!bot.entity?.position) return;
      if (loginSuccessful || Math.abs(bot.entity.velocity.y) > 0.05) {
        clearInterval(stateCheck);
        startSpamAndMovement(bot, username, chatLog);
      }
    }, 1000);

    setTimeout(() => {
      bot.quit('raiding complete');
      chatLog.write(`[FINISHED] ${new Date().toISOString()}\n`);
      chatLog.end();
    }, TEST_DURATION);
  });

  bot.on('end', () => {
    const msg = `[x] ${username} disconnected`;
    console.log(msg);
    chatLog.write(`[DISCONNECTED] ${new Date().toISOString()}\n`);
    chatLog.end();
    if (webhookUrl) sendWebhook(webhookUrl, `❌ ${username} disconnected`);
  });

  bot.on('kicked', (reason) => {
    const msg = `[X] ${username} kicked: ${reason}`;
    console.log(msg);
    chatLog.write(`[KICKED] ${reason}\n`);
    if (webhookUrl) sendWebhook(webhookUrl, `⚠️ ${username} kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    const msg = `[X] ${username} error: ${err.message}`;
    console.log(msg);
    chatLog.write(`[ERROR] ${err.message}\n`);
    if (webhookUrl) sendWebhook(webhookUrl, `❗ ${username} error: ${err.message}`);

    // retry if proxy failed
    if (retry < MAX_RETRIES) {
      setTimeout(() => {
        console.log(`[&] retrying ${username} (${retry + 1}/${MAX_RETRIES})`);
        tryCreateBot(username, webhookUrl, retry + 1);
      }, 1000);
    }
  });
}

// movement + chat
function startSpamAndMovement(bot, username, chatLog) {
  console.log(`[+] ${username} started behavior for modes: ${SELECTED_MODES.join(', ')}`);
  chatLog.write(`[STARTED MODES: ${SELECTED_MODES.join(', ')}] ${new Date().toISOString()}\n`);

  const chatInterval = setInterval(() => {
    const msg = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
    bot.chat(msg);
  }, CHAT_SPAM_INTERVAL_MS);

  // movement (destination mode)
  const moveInterval = setInterval(() => {
    if (!bot.entity?.position) return;
    if (!SELECTED_MODES.includes('destination')) return;

    const pos = bot.entity.position;
    const dx = TARGET_POS.x - pos.x;
    const dz = TARGET_POS.z - pos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance <= 1) {
      if (!hasReachedTarget) {
        hasReachedTarget = true;
        console.log(`[!] ${username} reached target`);
        bot.chat('Reached destination!');
      }
      bot.setControlState('forward', false);
    } else {
      const yaw = Math.atan2(-dx, dz);
      bot.look(yaw, 0, true);
      bot.setControlState('forward', true);
    }

    bot.setControlState('jump', pos.y < TARGET_POS.y);
  }, 500);

  // hostile mode (attack nearest player)
  const attackInterval = setInterval(() => {
    if (!SELECTED_MODES.includes('hostile') && !SELECTED_MODES.includes('rampage')) return;

    const target = bot.nearestEntity(entity =>
      entity.type === 'player' &&
      (!SELECTED_MODES.includes('hostile') || entity.username !== bot.username)
    );

    if (target) {
      bot.lookAt(target.position.offset(0, 1.5, 0));
      bot.attack(target);
    }
  }, 500);

  // rampage mode (attack any entity)
  const rampageInterval = setInterval(() => {
    if (!SELECTED_MODES.includes('rampage')) return;

    const target = bot.nearestEntity(entity =>
      entity.type !== 'object' &&
      entity.type !== 'player' &&
      entity.type !== 'unknown' &&
      entity.position &&
      bot.entity.position.distanceTo(entity.position) < 4
    );

    if (target) {
      bot.lookAt(target.position.offset(0, 1.0, 0));
      bot.attack(target);
    }
  }, 500);

  // grief mode (destroy nearby blocks like nuker)
const griefInterval = setInterval(async () => {
  if (!SELECTED_MODES.includes('grief')) return;
  if (bot.targetDigBlock) return; // Already digging

  const pos = bot.entity.position.floored();
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        const block = bot.blockAt(pos.offset(x, y, z));
        if (block && block.diggable && block.name !== 'air') {
          try {
            await bot.dig(block);
          } catch (err) {
            console.warn(`[${bot.username}] Digging failed: ${err.message}`);
          }
          return;
        }
      }
    }
  }
}, 300);

  // clear all on quit
  bot.once('end', () => {
    clearInterval(chatInterval);
    clearInterval(moveInterval);
    clearInterval(attackInterval);
    clearInterval(rampageInterval);
    clearInterval(griefInterval);
  });
}

// prompt for webhook
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function main() {
  let webhookUrl = null;

  const webhookChoice = await ask('discord webhook? (Y/N): ');
  if (webhookChoice.toLowerCase() === 'y') {
    webhookUrl = await ask('enter webhook URL: ');
  }

  console.log('\navailable modes:');
  console.log('1 = destination (move to target)');
  console.log('2 = hostile (attack nearest player)');
  console.log('3 = rampage (attack all entities)');
  console.log('4 = grief (destroy blocks)');
  console.log('Examples: "1", "2,3", "1,2,3,4"');

  const modeInput = await ask('Choose bot mode(s): ');
  const parsedModes = MODE_ALIASES[modeInput.trim()] || [];

  if (parsedModes.length === 0) {
    console.log('[!] Invalid selection. Defaulting to "destination".');
    SELECTED_MODES = ['destination'];
  } else {
    SELECTED_MODES = parsedModes;
    console.log(`[>] Selected modes: ${SELECTED_MODES.join(', ')}`);
  }

  for (let i = 0; i < NUM_BOTS; i++) {
    let username;
    do {
      username = generateUsername();
    } while (usedUsernames.has(username));

    saveUsername(username);

    setTimeout(() => tryCreateBot(username, webhookUrl), i * JOIN_DELAY_MS);
  }
}

main();

