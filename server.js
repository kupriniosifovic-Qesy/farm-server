const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== НАСТРОЙКИ ====================
const TELEGRAM_BOT_TOKEN = '9246537010:AAFX9DnhEPsrbz9lEZtsAEnlv5C_6_N6tAM';
const RENDER_EXTERNAL_URL = 'https://farm-server-8fyo.onrender.com';
// ТВОЯ СТРОКА ПОДКЛЮЧЕНИЯ К MONGODB
const MONGODB_URI = 'mongodb+srv://kupriinosifovic_db_user:qwerty123@farmcluster.pr639l2.mongodb.net/farmGame?retryWrites=true&w=majority&authSource=admin';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================
const client = new MongoClient(MONGODB_URI);
let db, playersCollection;

async function connectToMongo() {
  try {
    await client.connect();
    db = client.db('farmGame');
    playersCollection = db.collection('players');
    await playersCollection.createIndex({ telegramId: 1 }, { unique: true });
    console.log('✅ Успешно подключено к MongoDB');
  } catch (err) {
    console.error('❌ Ошибка подключения к MongoDB:', err);
    process.exit(1);
  }
}
connectToMongo();

// ==================== ВАЛИДАЦИЯ TELEGRAM initData ====================
function validateInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, error: 'No hash' };

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(TELEGRAM_BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const isValid = calculatedHash === hash;

    if (!isValid) {
      return { valid: false, error: 'Invalid hash' };
    }

    const authDate = parseInt(params.get('auth_date'), 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      return { valid: false, error: 'Data is too old' };
    }

    const user = JSON.parse(params.get('user'));
    return { valid: true, user };
  } catch (err) {
    return { valid: false, error: 'Parsing error' };
  }
}

// ==================== API ДЛЯ ИГРЫ ====================
app.post('/api/get-player', async (req, res) => {
  try {
    const { initData } = req.body;
    const validation = validateInitData(initData);

    if (!validation.valid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = validation.user;
    const telegramId = user.id.toString();

    let player = await playersCollection.findOne({ telegramId });

    if (!player) {
      const newPlayer = {
        telegramId,
        username: user.username || user.first_name || 'Фермер',
        coins: 100,
        level: 1,
        xp: 0,
        plots: Array.from({ length: 6 }, () => null),
        animals: {},
        upgrades: {},
        rarityUp: {},
        tools: { bucket: 0, can: 0, sprinkler: 0, drone: 0, harvester: 0 },
        animalUpgrades: {},
        greenhouse: { planted: null, upgrades: { light: 0, soil: 0, fence: 0 }, readyAt: 0 },
        hasAutoCollector: false,
        hasSpeedBooster: false,
        isVip: false,
        dailyStreak: 0,
        lastDailyClaim: 0,
        usedPromos: [],
        achievements: {},
        stats: { harvests: 0, ghHarvests: 0, rainbow: 0 },
        lastSeen: new Date(),
        createdAt: new Date()
      };
      await playersCollection.insertOne(newPlayer);
      player = newPlayer;
    } else {
      await playersCollection.updateOne(
        { telegramId },
        { $set: { lastSeen: new Date(), username: user.username || user.first_name || player.username } }
      );
    }

    delete player._id;
    delete player.createdAt;
    res.json({ success: true, player });
  } catch (err) {
    console.error('Ошибка в /api/get-player:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/save-player', async (req, res) => {
  try {
    const { initData, playerData } = req.body;
    const validation = validateInitData(initData);

    if (!validation.valid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const telegramId = validation.user.id.toString();

    if (playerData.coins < 0 || playerData.level < 1 || (playerData.xp && playerData.xp < 0)) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    delete playerData._id;
    delete playerData.telegramId;
    delete playerData.createdAt;
    playerData.lastSeen = new Date();

    await playersCollection.updateOne(
      { telegramId },
      { $set: playerData },
      { upsert: false }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка в /api/save-player:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ПЛАТЕЖИ (TELEGRAM STARS) ====================
const SHOP = {
  'coins_1m':   { title: '1 Миллион монет', price: 50, desc: 'Мгновенно начислит 1 000 000 монет.' },
  'coins_10m':  { title: '10 Миллионов монет', price: 300, desc: 'Мгновенно начислит 10 000 000 монет.' },
  'coins_100m': { title: '100 Миллионов монет', price: 1500, desc: 'Мгновенно начислит 100 000 000 монет.' },
  'autocollector': { title: 'Автосборщик', price: 150, desc: 'Собирает урожай сам каждые 10 секунд навсегда.' },
  'speedbooster':  { title: 'Вечный ускоритель', price: 400, desc: 'Навсегда ускоряет рост растений в 2 раза.' },
  'vip':           { title: 'VIP Статус', price: 1000, desc: 'Навсегда дает +50% ко всему доходу и золотой ник.' }
};

app.post(`/webhook/${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.post('/api/create-invoice', async (req, res) => {
  const { productId } = req.body;
  const product = SHOP[productId];
  if (!product) return res.status(400).json({ error: 'Товар не найден' });

  try {
    const invoiceLink = await bot.createInvoiceLink(
      product.title,
      product.desc,
      productId,
      '',
      'XTR',
      [{ label: product.title, amount: product.price }]
    );
    res.json({ invoiceLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка создания счета' });
  }
});

bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const payload = msg.successful_payment.invoice_payload;
  const telegramId = msg.from.id.toString();

  try {
    const player = await playersCollection.findOne({ telegramId });
    if (!player) {
      console.error('Игрок не найден:', telegramId);
      return bot.sendMessage(chatId, '❌ Ошибка: игрок не найден.');
    }

    const updates = {};
    if (payload === 'coins_1m') updates.coins = (player.coins || 0) + 1000000;
    else if (payload === 'coins_10m') updates.coins = (player.coins || 0) + 10000000;
    else if (payload === 'coins_100m') updates.coins = (player.coins || 0) + 100000000;
    else if (payload === 'autocollector') updates.hasAutoCollector = true;
    else if (payload === 'speedbooster') updates.hasSpeedBooster = true;
    else if (payload === 'vip') updates.isVip = true;

    await playersCollection.updateOne({ telegramId }, { $set: updates });
    bot.sendMessage(chatId, `✅ Оплата прошла! Вы купили: ${SHOP[payload].title}. Спасибо!`);
  } catch (err) {
    console.error('Ошибка при обработке платежа:', err);
    bot.sendMessage(chatId, '❌ Произошла ошибка при начислении награды. Обратитесь в поддержку.');
  }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер успешно запущен на порту ${PORT}`);

  bot.setWebHook(`${RENDER_EXTERNAL_URL}/webhook/${TELEGRAM_BOT_TOKEN}`)
    .then(() => console.log('Webhook успешно установлен!'))
    .catch(err => console.error('Ошибка установки webhook:', err));
});
