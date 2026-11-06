const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Твой токен от BotFather
const TELEGRAM_BOT_TOKEN = '9246537010:AAH2ocUoQZtCcaoa721mBz45y0-yk00tiw6w';
// Твоя ссылка от Render
const RENDER_EXTERNAL_URL = 'https://farm-server-8fyo.onrender.com';

// Создаем бота БЕЗ polling (так как он будет работать на хостинге через Webhook)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Список товаров
const SHOP = {
  'coins_1m': { title: '1 Миллион монет', price: 50, desc: 'Мгновенно начислит 1 000 000 монет.' },
  'coins_10m': { title: '10 Миллионов монет', price: 300, desc: 'Мгновенно начислит 10 000 000 монет.' },
  'coins_100m': { title: '100 Миллионов монет', price: 1500, desc: 'Мгновенно начислит 100 000 000 монет.' },
  'autocollector': { title: 'Автосборщик', price: 150, desc: 'Собирает урожай сам каждые 10 секунд навсегда.' },
  'speedbooster': { title: 'Вечный ускоритель', price: 400, desc: 'Навсегда ускоряет рост растений в 2 раза.' },
  'vip': { title: 'VIP Статус', price: 1000, desc: 'Навсегда дает +50% ко всему доходу и золотой ник.' }
};

// API для создания счета из игры
app.post('/api/create-invoice', async (req, res) => {
  try {
    const { productId } = req.body;
    const product = SHOP[productId];

    if (!product) {
      return res.status(400).json({ error: 'Товар не найден' });
    }

    // Создаем инвойс через Telegram Stars API
    const invoice = await bot.createInvoiceLink(
      product.title,
      product.desc,
      productId, // payload
      '', // provider_token (пусто для Stars)
      'XTR', // currency (Telegram Stars)
      [{ label: product.title, amount: product.price }] // prices
    );

    res.json({ invoiceLink: invoice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка при создании счета' });
  }
});

// Обработка Webhook (сюда Telegram присылает уведомления об оплате)
app.post(`/webhook/${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Обработка предоплаты (нужно подтверждать, чтобы Telegram показал окно оплаты)
bot.on('pre_checkout_query', (query) => {
  bot.answerPreCheckoutQuery(query.id, true);
});

// Обработка успешного платежа
bot.on('successful_payment', (msg) => {
  const payload = msg.successful_payment.invoice_payload;
  const userId = msg.from.id;
  console.log(`✅ Пользователь ${userId} купил ${payload}`);
});

// Установка Webhook при запуске сервера
bot.setWebHook(`${RENDER_EXTERNAL_URL}/webhook/${TELEGRAM_BOT_TOKEN}`)
  .then(() => console.log('Webhook успешно установлен!'))
  .catch((err) => console.error('Ошибка установки Webhook:', err));

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер успешно запущен на порту ${PORT}`);
});
