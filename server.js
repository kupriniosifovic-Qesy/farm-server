const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== НАСТРОЙКИ ====================
const TELEGRAM_BOT_TOKEN = '9246537010:AAEFGwCVwXbgUwJWFI0Su4_T2Bq2kHvsh20';
const RENDER_EXTERNAL_URL = 'https://farm-server-8fyo.onrender.com';
const MONGODB_URI = 'mongodb+srv://farmesGames:QZwWBTW9Zw58dMl5@farmcluster.pr639l2.mongodb.net/farmGame?retryWrites=true&w=majority&authSource=admin';
const GAME_URL = 'https://kupriniosifovic-qesy.github.io/farm-game/';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
  polling: false,
  request: { agentOptions: { keepAlive: true, family: 4 } } 
});

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

// Регистрируем команды в меню бота
bot.setMyCommands([
  { command: 'start', description: '🎮 Запустить игру' },
  { command: 'help', description: '📖 Инструкция по игре' },
  { command: 'channel', description: '📢 Наш Telegram-канал' }
]).then(() => console.log('✅ Меню команд установлено!'))
  .catch((err) => console.error('❌ Ошибка установки меню:', err));

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

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) return { valid: false, error: 'Invalid hash' };

    const authDate = parseInt(params.get('auth_date'), 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return { valid: false, error: 'Data is too old' };

    const user = JSON.parse(params.get('user'));
    return { valid: true, user };
  } catch (err) {
    return { valid: false, error: 'Parsing error' };
  }
}

// ==================== API: ЗАГРУЗКА ИГРОКА ====================
app.post('/api/get-player', async (req, res) => {
  try {
    const { initData } = req.body;
    const validation = validateInitData(initData);
    if (!validation.valid) return res.status(401).json({ error: 'Unauthorized' });

    const user = validation.user;
    const telegramId = user.id.toString();

    let player = await playersCollection.findOne({ telegramId });

    if (!player) {
      const newPlayer = {
        telegramId,
        username: user.username || user.first_name || 'Фермер',
        coins: 100, level: 1, xp: 0, stars: 0,
        plots: Array.from({ length: 6 }, () => null),
        animals: {}, upgrades: {}, rarityUp: {},
        tools: { bucket: 0, can: 0, sprinkler: 0, drone: 0, harvester: 0 },
        animalUpgrades: {},
        greenhouse: { planted: null, upgrades: { light: 0, soil: 0, fence: 0 }, readyAt: 0 },
        hasAutoCollector: false, hasSpeedBooster: false, isVip: false,
        dailyStreak: 0, lastDailyClaim: 0, usedPromos: [],
        achievements: {}, 
        stats: { harvests: 0, ghHarvests: 0, rainbow: 0, coinsSpent: 0, wheelSpins: 0 },
        quests: { daily: null, weekly: null, dailyTime: 0, weeklyTime: 0, dailyClaimed: false, weeklyClaimed: false },
        referralCount: 0, referredBy: null, referralRewarded: false,
        lastSeen: new Date(), createdAt: new Date(),
        lastTick: Date.now(), lastAdTime: 0, lastWheelSpin: 0, feedEndTime: 0,
        activeEvent: null, selectedCrop: 'wheat', sound: true, tempVipEndTime: 0,
        hasGoldenShovel: false, hasLifeElixir: false, hasBusinessCenter: false
      };
      await playersCollection.insertOne(newPlayer);
      player = newPlayer;
    } else {
      // ЛОГИКА РЕФЕРАЛЬНОЙ НАГРАДЫ
      if (player.level >= 3 && player.referredBy && !player.referralRewarded) {
        const referrer = await playersCollection.findOne({ telegramId: player.referredBy });
        if (referrer) {
          await playersCollection.updateOne({ telegramId: player.referredBy }, { $inc: { coins: 500000, referralCount: 1 } });
          await playersCollection.updateOne({ telegramId }, { $inc: { coins: 500000 }, $set: { referralRewarded: true } });
          bot.sendMessage(player.referredBy, '🎉 Ваш друг достиг 3 уровня! Вы получили +500 000 монет!').catch(()=>{});
          
          player.coins = (player.coins || 0) + 500000;
          player.referralRewarded = true;
        }
      }

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

// ==================== API: СОХРАНЕНИЕ ИГРОКА ====================
app.post('/api/save-player', async (req, res) => {
  try {
    const { initData, playerData } = req.body;
    const validation = validateInitData(initData);
    if (!validation.valid) return res.status(401).json({ error: 'Unauthorized' });

    const telegramId = validation.user.id.toString();
    
    // ==========================================
    // 🛡️ ЗАЩИТА БАЗЫ ДАННЫХ ОТ ПОВРЕЖДЕНИЯ
    // ==========================================
    if (typeof playerData.coins !== 'number' || isNaN(playerData.coins) || playerData.coins < 0) playerData.coins = 100;
    if (typeof playerData.level !== 'number' || playerData.level < 1) playerData.level = 1;
    if (typeof playerData.xp !== 'number' || playerData.xp < 0) playerData.xp = 0;
    
    if (!Array.isArray(playerData.usedPromos)) playerData.usedPromos = [];
    if (!Array.isArray(playerData.plots) || playerData.plots.length === 0) {
      playerData.plots = Array.from({ length: 6 }, () => null);
    }
    if (typeof playerData.stats !== 'object' || playerData.stats === null) {
      playerData.stats = { harvests: 0, ghHarvests: 0, rainbow: 0, coinsSpent: 0, wheelSpins: 0 };
    }
    if (typeof playerData.quests !== 'object' || playerData.quests === null) {
      playerData.quests = { daily: null, weekly: null, dailyTime: 0, weeklyTime: 0, dailyClaimed: false, weeklyClaimed: false };
    }
    // ==========================================

    delete playerData._id; 
    delete playerData.telegramId; 
    delete playerData.createdAt;
    playerData.lastSeen = new Date();

    await playersCollection.updateOne({ telegramId }, { $set: playerData });
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка в /api/save-player:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== API: РЕКЛАМА ADSGRAM ====================
app.get('/api/adsgram-reward', async (req, res) => {
  const { userid } = req.query;
  if (!userid) return res.status(400).send('Missing userid');

  try {
    const telegramId = userid.toString();
    const player = await playersCollection.findOne({ telegramId });
    if (!player) return res.status(404).send('Player not found');

    const now = Date.now();
    if (player.lastAdTime && (now - player.lastAdTime < 600000)) {
      return res.status(429).send('Too many requests');
    }

    const reward = 25000; 
    await playersCollection.updateOne(
      { telegramId },
      { $inc: { coins: reward }, $set: { lastAdTime: now } }
    );

    console.log(`✅ Награда за рекламу начислена ${telegramId}: +${reward} монет`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Ошибка в /api/adsgram-reward:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ==================== ПЛАТЕЖИ (TELEGRAM STARS) ====================
const SHOP = {
  'coins_10m':   { title: '10 Миллионов монет', price: 49, desc: 'Мгновенно начислит 10 000 000 монет.' },
  'coins_100m':  { title: '100 Миллионов монет', price: 149, desc: 'Мгновенно начислит 100 000 000 монет.' },
  'coins_1b':    { title: '1 Миллиард монет', price: 189, desc: 'Станьте настоящим магнатом.' },
  'coins_5b':    { title: '5 Миллиардов монет', price: 289, desc: 'Для самых амбициозных фермеров.' },
  'coins_10b':   { title: '10 Миллиардов монет', price: 499, desc: 'Абсолютное богатство.' },
  'starter_pack': { title: '🎁 Сундук новичка', price: 29, desc: 'Получи 5 000 000 монет.' },
  'booster_pack': { title: '⚡ Пакет ускорения', price: 49, desc: 'Получи 15 000 000 монет.' },
  'lucky_case':   { title: '🎰 Кейс удачи', price: 29, desc: 'Случайная награда: от 1М до 50М монет.' },
  'farmer_pack':  { title: '👨‍🌾 Набор фермера', price: 179, desc: '30 000 000 монет и VIP-статус.' },
  'autocollector': { title: '🤖 Автосборщик', price: 249, desc: 'Собирает урожай сам каждые 10 секунд.' },
  'speedbooster':  { title: '⚡ Вечный ускоритель', price: 299, desc: 'Растения растут в 2 раза быстрее.' },
  'vip':           { title: '👑 VIP Статус', price: 1089, desc: '+50% ко всему доходу навсегда.' },
  'golden_shovel': { title: '🥇 Золотая лопата', price: 389, desc: '+100% к весу урожая навсегда.' },
  'life_elixir':   { title: '🧪 Эликсир жизни', price: 569, desc: 'Офлайн-доход работает до 24 часов.' },
  'business_center': { title: '🏢 Бизнес-центр', price: 949, desc: '+100% к доходу животных навсегда.' }
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
      product.title, product.desc, productId, '', 'XTR',
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
    if (!player) return bot.sendMessage(chatId, '❌ Ошибка: игрок не найден.');

    const updates = {};
    if (payload === 'coins_10m') updates.coins = (player.coins || 0) + 10000000;
    else if (payload === 'coins_100m') updates.coins = (player.coins || 0) + 100000000;
    else if (payload === 'coins_1b') updates.coins = (player.coins || 0) + 10000000000;
    else if (payload === 'coins_5b') updates.coins = (player.coins || 0) + 150000000000;
    else if (payload === 'coins_10b') updates.coins = (player.coins || 0) + 1000000000000;
    
    else if (payload === 'starter_pack') updates.coins = (player.coins || 0) + 5000000;
    else if (payload === 'booster_pack') updates.coins = (player.coins || 0) + 15000000;
    else if (payload === 'farmer_pack') { 
      updates.coins = (player.coins || 0) + 30000000; 
      updates.tempVipEndTime = Date.now() + (12 * 60 * 60 * 1000); 
    }
    else if (payload === 'lucky_case') updates.coins = (player.coins || 0) + (Math.floor(Math.random() * 49) + 1) * 1000000;
    
    else if (payload === 'autocollector') updates.hasAutoCollector = true;
    else if (payload === 'speedbooster') updates.hasSpeedBooster = true;
    else if (payload === 'vip') updates.isVip = true;
    else if (payload === 'golden_shovel') updates.hasGoldenShovel = true;
    else if (payload === 'life_elixir') updates.hasLifeElixir = true;
    else if (payload === 'business_center') updates.hasBusinessCenter = true;

    await playersCollection.updateOne({ telegramId }, { $set: updates });
    bot.sendMessage(chatId, `✅ Оплата прошла! Вы купили: ${SHOP[payload].title}. Спасибо!`);
  } catch (err) {
    console.error('Ошибка при обработке платежа:', err);
    bot.sendMessage(chatId, '❌ Ошибка при начислении награды.');
  }
});

// ==================== МЕНЮ БОТА ====================
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'друг';
  
  const refParam = match[1].trim(); 
  const telegramId = msg.from.id.toString();

  // РЕФЕРАЛЬНАЯ СИСТЕМА
  if (refParam.startsWith('ref_')) {
    const referrerId = refParam.replace('ref_', '');
    if (referrerId !== telegramId) {
      try {
        await playersCollection.updateOne(
          { telegramId: telegramId },
          { 
            $setOnInsert: { 
              referredBy: referrerId,
              username: msg.from.username || msg.from.first_name || 'Фермер',
              coins: 100, level: 1, xp: 0, stars: 0,
              plots: Array.from({ length: 6 }, () => null),
              animals: {}, upgrades: {}, rarityUp: {},
              tools: { bucket: 0, can: 0, sprinkler: 0, drone: 0, harvester: 0 },
              animalUpgrades: {},
              greenhouse: { planted: null, upgrades: { light: 0, soil: 0, fence: 0 }, readyAt: 0 },
              hasAutoCollector: false, hasSpeedBooster: false, isVip: false,
              dailyStreak: 0, lastDailyClaim: 0, usedPromos: [],
              achievements: {}, stats: { harvests: 0, ghHarvests: 0, rainbow: 0, coinsSpent: 0, wheelSpins: 0 },
              quests: { daily: null, weekly: null, dailyTime: 0, weeklyTime: 0, dailyClaimed: false, weeklyClaimed: false },
              referralCount: 0, referralRewarded: false,
              lastSeen: new Date(), createdAt: new Date(),
              lastTick: Date.now(), lastAdTime: 0, lastWheelSpin: 0, feedEndTime: 0,
              activeEvent: null, selectedCrop: 'wheat', sound: true, tempVipEndTime: 0,
              hasGoldenShovel: false, hasLifeElixir: false, hasBusinessCenter: false
            }
          },
          { upsert: true } 
        );
        console.log(`✅ Пользователь ${telegramId} пришел по реф. ссылке от ${referrerId}`);
      } catch (err) {
        console.error('Ошибка сохранения реферала:', err);
      }
    }
  }
  
  const text = `
👋 <b>Привет, ${userName}!</b>

Добро пожаловать в <b>«Ферма: Империя»</b> — увлекательную экономическую игру прямо в Telegram! 🌾

Здесь ты сможешь построить свою собственную фермерскую империю, выращивать редкие культуры, разводить животных и зарабатывать настоящие Telegram Stars! ⭐

Жми кнопку ниже, чтобы начать свое восхождение к богатству! 👇
  `;

  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌾 ИГРАТЬ', web_app: { url: GAME_URL } }],
        [{ text: '📖 Как играть?', callback_data: 'help_game' }],
        [{ text: '⭐ Что такое Stars?', callback_data: 'help_stars' }],
        [{ text: '📢 Наш Телеграм-канал', url: 'https://t.me/QesyGames_Official' }]
      ]
    }
  });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `
📖 <b>ИНСТРУКЦИЯ ПО ВЫЖИВАНИЮ</b> 🌱

1️⃣ <b>Посадка:</b> Зайди во вкладку «Ферма», выбери семена и нажми «Посадить».
2️⃣ <b>Сбор урожая:</b> Когда таймер закончится, нажми на грядку, чтобы собрать урожай.
3️⃣ <b>Животные:</b> Покупай курочек и коров — они дают пассивный доход каждую секунду!
4️⃣ <b>Улучшения:</b> Трать монеты на ускорение роста и повышение цен.
5️⃣ <b>Колесо Фортуны:</b> Крути колесо 🎡 в правом нижнем углу игры, чтобы выиграть джекпот!

🔒 <b>Уровни:</b> Чем больше ты собираешь урожая, тем выше твой уровень. Новые семена и животные открываются по мере прокачки!
  `;
  bot.sendMessage(chatId, helpText, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[ { text: '✅ Понятно, играть!', web_app: { url: GAME_URL } } ]] }
  });
});

bot.onText(/\/channel/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '📢 Подписывайся на наш официальный канал с новостями и промокодами!', {
    reply_markup: { inline_keyboard: [[ { text: 'Перейти в канал', url: 'https://t.me/QesyGames_Official' } ]] }
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  
  if (query.data === 'help_game') {
    bot.answerCallbackQuery(query.id, { text: 'Загружаем инструкцию...' });
    const helpText = `📖 <b>ИНСТРУКЦИЯ ПО ВЫЖИВАНИЮ</b> 🌱\n\n1️⃣ <b>Посадка:</b> Зайди во вкладку «Ферма», выбери семена и нажми «Посадить». \n2️⃣ <b>Сбор урожая:</b> Когда таймер закончится, нажми на грядку, чтобы собрать урожай и получить монеты!\n3️⃣ <b>Животные:</b> Покупай курочек и коров — они дают пассивный доход каждую секунду!\n4️⃣ <b>Улучшения:</b> Трать монеты на ускорение роста и повышение цен.\n5️⃣ <b>Колесо Фортуны:</b> Крути колесо 🎡 в правом нижнем углу игры, чтобы выиграть джекпот!\n\n🔒 <b>Уровни:</b> Чем больше ты собираешь урожая, тем выше твой уровень. Новые семена и животные открываются по мере прокачки!`;
    bot.sendMessage(chatId, helpText, { 
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[ { text: '✅ Понятно, играть!', web_app: { url: GAME_URL } } ]] }
    });
  }
  
  if (query.data === 'help_stars') {
    bot.answerCallbackQuery(query.id, { text: 'Информация о Stars' });
    const starsText = `⭐ <b>Telegram Stars (Звезды)</b> — это официальная валюта Telegram.\n\nЗачем они нужны в игре?\nВ нашем магазине (вкладка «Донат») ты можешь купить за звездочки мощные бонусы:\n🤖 <b>Автосборщик</b> — собирает урожай за тебя каждые 10 секунд.\n⚡ <b>Вечный ускоритель</b> — растения растут в 2 раза быстрее навсегда.\n👑 <b>VIP-статус</b> — дает +50% к общему доходу.\n💰 <b>Пакеты монет</b> — для быстрого старта.\n\nВсе покупки навсегда сохраняются в твоем аккаунте и не сгорают при перерождении (Престиже)!`;
    bot.sendMessage(chatId, starsText, { 
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[ { text: '⭐ Перейти в магазин', web_app: { url: GAME_URL } } ]] }
    });
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
