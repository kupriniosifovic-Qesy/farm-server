const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// 1. Сюда вставь токен от BotFather
const TELEGRAM_BOT_TOKEN = '9246537010:AAH2ocUoCZtCaoa72JmBz45yO-ykOOtiw6w'; 

// 2. Сюда мы вставим ссылку от Render (например, https://my-farm-bot.onrender.com)
const RENDER_EXTERNAL_URL = 'https://farm-server-8fyo.onrender.com'; 

// Создаем бота БЕЗ polling (так как он будет работать на хостинге)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Список товаров
const SHOP = {
  'coins_1m':      { title: '1 Миллион монет', price: 49,  desc: 'Мгновенно начислит 1 000 000 монет.' },
  'coins_10m':     { title: '10 Миллионов монет', price: 159, desc: 'Мгновенно начислит 10 000 000 монет.' },
  'coins_100m':    { title: '100 Миллионов монет', price: 899, desc: 'Мгновенно начислит 100 000 000 монет.' },
  'autocollector': { title: 'Автосборщик', price: 149, desc: 'Собирает урожай сам каждые 10 секунд навсегда.' },
  'speedbooster':  { title: 'Вечный ускоритель', price: 369, desc: 'Навсегда ускоряет рост растений в 2 раза.' },
  'vip':           { title: 'VIP Статус', price: 1000, desc: 'Навсегда дает +50% ко всему доходу и золотой ник.' }
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

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер успешно запущен на порту ${PORT}`);
  
  // Сообщаем Telegram, куда присылать сообщения (только если ссылка Render уже вставлена)
  if (RENDER_EXTERNAL_URL && RENDER_EXTERNAL_URL !== 'ССЫЛКА_ОТ_RENDER') {
    bot.setWebHook(`${RENDER_EXTERNAL_URL}/webhook/${TELEGRAM_BOT_TOKEN}`)
      .then(() => console.log('Webhook успешно установлен!'))
      .catch(err => console.error('Ошибка установки webhook:', err));
  }
});
