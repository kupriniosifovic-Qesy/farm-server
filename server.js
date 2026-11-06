const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// 1. Твой токен от BotFather
const TELEGRAM_BOT_TOKEN = '9246537010:AAFX9DnhEPsrbz9lEZtsAEnlv5C_6_N6tAM'; 

// 2. Твоя ссылка от Render
const RENDER_EXTERNAL_URL = 'https://farm-server-8fyo.onrender.com'; 

// Создаем бота БЕЗ polling (так как он работает на хостинге)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Список товаров (должен совпадать с index.html)
const SHOP = {
  'coins_1m': { title: '1 Миллион монет', price: 50, desc: 'Мгновенно начислит 1 000 000 монет.' },
  'coins_10m': { title: '10 Миллионов монет', price: 300, desc: 'Мгновенно начислит 10 000 000 монет.' },
  'coins_100m': { title: '100 Миллионов монет', price: 899, desc: 'Мгновенно начислит 100 000 000 монет.' },
  'autocollector': { title: 'Автосборщик', price: 150, desc: 'Собирает урожай сам каждые 10 секунд навсегда.' },
  'speedbooster': { title: 'Вечный ускоритель', price: 400, desc: 'Навсегда ускоряет рост растений в 2 раза.' },
  'vip': { title: 'VIP Статус', price: 1000, desc: 'Навсегда дает +50% ко всему доходу и золотой ник.' }
};

// --- Webhook endpoint: сюда Telegram будет присылать сообщения об оплате ---
app.post(`/webhook/${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// 1. Игра просит создать счет
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

// 2. Telegram присылает уведомление об оплате
bot.on('successful_payment', (msg) => {
  const payload = msg.successful_payment.invoice_payload;
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `✅ Оплата прошла! Вы купили: ${SHOP[payload].title}. Спасибо!`);
});
// ================= КРАСИВОЕ МЕНЮ БОТА И ОБУЧЕНИЕ =================

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'друг';
  
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
        [{ text: '🌾 ИГРАТЬ', web_app: { url: 'https://classy-speculoos-95b985.netlify.app' } }],
        [{ text: '📖 Как играть?', callback_data: 'help_game' }],
        [{ text: '⭐ Что такое Stars?', callback_data: 'help_stars' }],
        [{ text: '💬 Поддержка', url: 'https://t.me/Qesyj' }] // Замени на свой ник!
      ]
    }
  });
});

// Обработка нажатий на кнопки "Как играть" и "Что такое Stars"
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  
  if (query.data === 'help_game') {
    bot.answerCallbackQuery(query.id, { text: 'Загружаем инструкцию...' });
    
    const helpText = `
📖 <b>ИНСТРУКЦИЯ ПО ВЫЖИВАНИЮ</b> 🌱

1️⃣ <b>Посадка:</b> Зайди во вкладку «Ферма», выбери семена и нажми «Посадить». 
2️⃣ <b>Сбор урожая:</b> Когда таймер закончится, нажми на грядку, чтобы собрать урожай и получить монеты!
3️⃣ <b>Животные:</b> Покупай курочек и коров — они дают пассивный доход каждую секунду!
4️⃣ <b>Улучшения:</b> Трать монеты на ускорение роста и повышение цен.
5️⃣ <b>Колесо Фортуны:</b> Крути колесо 🎡 в правом нижнем углу игры, чтобы выиграть джекпот!

🔒 <b>Уровни:</b> Чем больше ты собираешь урожая, тем выше твой уровень. Новые семена и животные открываются по мере прокачки!
    `;
    
    bot.sendMessage(chatId, helpText, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🌾 Понятно, играть!', web_app: { url: 'https://classy-speculoos-95b985.netlify.app' } }]]
      }
    });
  }
  
  if (query.data === 'help_stars') {
    bot.answerCallbackQuery(query.id, { text: 'Информация о Stars' });
    
    const starsText = `
⭐ <b>Telegram Stars (Звезды)</b> — это официальная валюта Telegram.

Зачем они нужны в игре?
В нашем магазине (вкладка «Донат») ты можешь купить за звездочки мощные бонусы:
🤖 <b>Автосборщик</b> — собирает урожай за тебя каждые 10 секунд.
⚡ <b>Вечный ускоритель</b> — растения растут в 2 раза быстрее навсегда.
👑 <b>VIP-статус</b> — дает +50% к общему доходу.
💰 <b>Пакеты монет</b> — для быстрого старта.

Все покупки навсегда сохраняются в твоем аккаунте и не сгорают при перерождении (Престиже)!
    `;
    
    bot.sendMessage(chatId, starsText, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⭐ Перейти в магазин', web_app: { url: 'https://classy-speculoos-95b985.netlify.app' } }]]
      }
    });
  }
});
// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер успешно запущен на порту ${PORT}`);
  
  // Сообщаем Telegram, куда присылать сообщения
  bot.setWebHook(`${RENDER_EXTERNAL_URL}/webhook/${TELEGRAM_BOT_TOKEN}`)
    .then(() => console.log('Webhook успешно установлен!'))
    .catch(err => console.error('Ошибка установки webhook:', err));
});
