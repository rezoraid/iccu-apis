'use strict';

const TelegramBot = require('node-telegram-bot-api');
const monitor = require('./monitor');

let botInstance = null;
let configInstance = null;

function startBot(config) {
  const token = config.telegram?.token;
  const ownerIds = config.telegram?.ownerIds || [];

  if (!token || token === 'PASTE_BOT_TOKEN_HERE') {
    console.log('[bot] Telegram token not set in src/config.js, skipping bot startup');
    return null;
  }

  configInstance = config;
  botInstance = new TelegramBot(token, { polling: true });

  const mainMenu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Statistik Request', callback_data: 'stats' }],
        [{ text: '📋 Log Terbaru', callback_data: 'logs' }],
        [{ text: '🔝 IP Teratas', callback_data: 'top_ips' }],
        [{ text: '🚫 Daftar IP Diblokir', callback_data: 'list_blocked' }],
        [{ text: '🔒 Blokir IP', callback_data: 'block_prompt' }],
        [{ text: '🔓 Buka Blokir IP', callback_data: 'unblock_prompt' }]
      ]
    }
  };

  function isOwner(msg) {
    if (!ownerIds.length) return true;
    return ownerIds.includes(String(msg.chat.id));
  }

  function deny(chatId) {
    botInstance.sendMessage(chatId, '❌ Kamu tidak punya akses ke bot ini.');
  }

  botInstance.onText(/\/start|\/menu/, (msg) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    botInstance.sendMessage(
      msg.chat.id,
      `🤖 ${config.identity.name} Monitor\nPilih menu di bawah:`,
      mainMenu
    );
  });

  botInstance.onText(/\/block (.+)/, (msg, match) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    const ip = match[1].trim();
    monitor.blockIp(ip);
    botInstance.sendMessage(msg.chat.id, `✅ IP ${ip} sudah diblokir.`);
  });

  botInstance.onText(/\/unblock (.+)/, (msg, match) => {
    if (!isOwner(msg)) return deny(msg.chat.id);
    const ip = match[1].trim();
    const removed = monitor.unblockIp(ip);
    botInstance.sendMessage(msg.chat.id, removed ? `✅ IP ${ip} sudah dibuka blokirnya.` : `❌ IP ${ip} tidak ada di daftar blokir.`);
  });

  botInstance.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (!isOwner({ chat: { id: chatId } })) {
      await botInstance.answerCallbackQuery(query.id);
      return deny(chatId);
    }

    const data = query.data;

    if (data && data.startsWith('block_')) {
      const ip = data.replace('block_', '');
      monitor.blockIp(ip);
      await botInstance.answerCallbackQuery(query.id, { text: `✅ IP ${ip} diblokir!` });
      botInstance.sendMessage(chatId, `✅ IP ${ip} berhasil diblokir.`);
      return;
    }

    switch (data) {
      case 'stats': {
        const total = monitor.totalRequests();
        const top = monitor.topEndpoints(5);
        const lines = top.map((r) => `${r.count}x  ${r.path}`).join('\n') || 'Belum ada data.';
        botInstance.sendMessage(chatId, `📊 Total request tercatat: ${total}\n\n🔝 Top endpoint:\n${lines}`);
        break;
      }
      case 'logs': {
        const recent = monitor.recentLog(15);
        if (!recent.length) {
          botInstance.sendMessage(chatId, '📭 Belum ada request tercatat.');
          break;
        }
        const lines = recent
          .map((r) => `${r.status} ${r.method} ${r.path} (${r.ms}ms) — ${r.ip}`)
          .join('\n');
        botInstance.sendMessage(chatId, `📋 Log 15 request terakhir:\n${lines}`);
        break;
      }
      case 'top_ips': {
        const top = monitor.topIps(10);
        if (!top.length) {
          botInstance.sendMessage(chatId, '📭 Belum ada data IP.');
          break;
        }
        const lines = top
          .map((r) => `${r.count}x  ${r.ip}${r.blocked ? ' 🚫' : ''}`)
          .join('\n');
        botInstance.sendMessage(chatId, `🔝 IP teratas:\n${lines}`);
        break;
      }
      case 'list_blocked': {
        const blocked = monitor.listBlocked();
        botInstance.sendMessage(
          chatId,
          blocked.length ? `🚫 IP yang diblokir:\n${blocked.join('\n')}` : '✅ Belum ada IP yang diblokir.'
        );
        break;
      }
      case 'block_prompt': {
        botInstance.sendMessage(chatId, '🔒 Kirim perintah: /block 1.2.3.4');
        break;
      }
      case 'unblock_prompt': {
        botInstance.sendMessage(chatId, '🔓 Kirim perintah: /unblock 1.2.3.4');
        break;
      }
      default:
        break;
    }

    await botInstance.answerCallbackQuery(query.id);
  });

  botInstance.on('polling_error', (err) => {
    console.error('[bot] polling error:', err.message);
  });

  console.log('[bot] Telegram bot started');
  return botInstance;
}

function sendNotification(ip, method, path, status, ms, userAgent) {
  if (!botInstance || !configInstance) return;

  const ownerIds = configInstance.telegram?.ownerIds || [];
  if (!ownerIds.length) return;

  const statusEmoji = status >= 200 && status < 300 ? '✅' : '❌';
  const message = `
🔔 *Request Masuk*

📌 *IP:* \`${ip}\`
📱 *Method:* ${method}
🔗 *Path:* ${path}
📊 *Status:* ${statusEmoji} ${status}
⏱ *Waktu:* ${ms}ms
🖥 *User Agent:* ${userAgent || 'Tidak diketahui'}
🕐 *Waktu:* ${new Date().toISOString()}

${status >= 400 ? '⚠️ *Perhatian! Request gagal!*' : '✅ *Request berhasil diproses*'}
  `;

  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: `🚫 Block IP: ${ip}`, callback_data: `block_${ip}` }],
        [{ text: '📊 Lihat Statistik', callback_data: 'stats' }]
      ]
    }
  };

  ownerIds.forEach(ownerId => {
    botInstance.sendMessage(ownerId, message.trim(), {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    }).catch(err => console.error('[bot] Failed to send notification:', err.message));
  });
}

module.exports = { startBot, sendNotification };